import fs from "node:fs";
import path from "node:path";
import { runPowerShell } from "./powershell.js";

// Everything that starts with Windows: Run keys, Startup folders, scheduled tasks, auto-start services,
// Winlogon values, debugger hijacks and WMI event consumers. Read-only.

const SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
$out = New-Object System.Collections.Generic.List[object]
function Add($source, $location, $name, $command, $extra) {
  $out.Add([pscustomobject]@{ source = $source; location = $location; name = [string]$name; command = [string]$command; publisher = $extra })
}
$runKeys = @(
  'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run', 'HKCU:\Software\Microsoft\Windows\CurrentVersion\RunOnce',
  'HKLM:\Software\Microsoft\Windows\CurrentVersion\Run', 'HKLM:\Software\Microsoft\Windows\CurrentVersion\RunOnce',
  'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Run', 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\RunOnce')
foreach ($k in $runKeys) {
  $p = Get-ItemProperty -Path $k
  if ($p) { $p.PSObject.Properties | Where-Object { $_.Name -notlike 'PS*' } | ForEach-Object { Add 'registry' ($k -replace ':', '') $_.Name $_.Value $null } }
}
$shell = New-Object -ComObject WScript.Shell
foreach ($d in @([Environment]::GetFolderPath('Startup'), [Environment]::GetFolderPath('CommonStartup'))) {
  Get-ChildItem -LiteralPath $d -File | Where-Object { $_.Name -ne 'desktop.ini' } | ForEach-Object {
    if ($_.Extension -eq '.lnk') { $s = $shell.CreateShortcut($_.FullName); Add 'startup-folder' $d $_.Name ('"' + $s.TargetPath.Trim('"') + '" ' + $s.Arguments) $null }
    else { Add 'startup-folder' $d $_.Name ('"' + $_.FullName + '"') $null }
  }
}
Get-ScheduledTask | Where-Object { $_.State -ne 'Disabled' } | ForEach-Object {
  $t = $_
  foreach ($a in $t.Actions) { if ($a.Execute) { Add 'task' $t.TaskPath $t.TaskName ('"' + $a.Execute.Trim('"') + '" ' + $a.Arguments) $t.Author } }
}
Get-CimInstance Win32_Service | Where-Object { $_.StartMode -eq 'Auto' -and $_.PathName } | ForEach-Object { Add 'service' 'Services' $_.Name $_.PathName $_.DisplayName }
$wl = Get-ItemProperty 'HKLM:\Software\Microsoft\Windows NT\CurrentVersion\Winlogon'
if ($wl) { Add 'winlogon' 'Winlogon' 'Shell' $wl.Shell $null; Add 'winlogon' 'Winlogon' 'Userinit' $wl.Userinit $null }
Get-ChildItem 'HKLM:\Software\Microsoft\Windows NT\CurrentVersion\Image File Execution Options' | ForEach-Object {
  $dbg = (Get-ItemProperty $_.PSPath).Debugger
  if ($dbg) { Add 'debugger' 'Image File Execution Options' $_.PSChildName $dbg $null }
}
Get-CimInstance -Namespace root/subscription -ClassName CommandLineEventConsumer | ForEach-Object { Add 'wmi' 'WMI event consumer' $_.Name $_.CommandLineTemplate $null }
$out | ConvertTo-Json -Compress -Depth 3
`;

const HOSTS = new Set(["rundll32.exe", "regsvr32.exe", "powershell.exe", "pwsh.exe", "cmd.exe", "wscript.exe", "cscript.exe", "mshta.exe", "conhost.exe"]);
// Windows' own programs that can be talked into running anything ("living off the land").
// A hidden window alone is normal for scheduled maintenance; a URL, an encoded command or a download is not.
const LOLBIN_RISK = /(https?:\/\/|\\\\[a-z0-9.-]+\\|-enc(odedcommand)?\s|frombase64string|downloadstring|iex\s*\(|javascript:|vbscript:|\/i:http)/i;

function expand(text) {
  return text.replace(/%([^%]+)%/g, (m, name) => process.env[name] ?? process.env[name.toUpperCase()] ?? m);
}

// Finds the program a command line starts, and for hosts like rundll32 or powershell, the file they run.
export function parseCommand(command, exists = fs.existsSync) {
  const cmd = expand(String(command ?? "").trim());
  if (!cmd) return { exe: null, target: null, args: "", host: null };
  let exe = null;
  let args = "";
  const quoted = /^"([^"]+)"\s*(.*)$/s.exec(cmd);
  if (quoted) {
    exe = quoted[1];
    args = quoted[2];
  } else {
    // Unquoted paths with spaces: grow the candidate until it names an existing file.
    const parts = cmd.split(" ");
    for (let i = 1; i <= parts.length; i++) {
      const candidate = parts.slice(0, i).join(" ");
      const withExe = /\.\w{2,4}$/.test(candidate) ? candidate : `${candidate}.exe`;
      if (exists(candidate) || exists(withExe)) {
        exe = exists(candidate) ? candidate : withExe;
        args = parts.slice(i).join(" ");
        break;
      }
    }
    if (!exe) {
      exe = parts[0];
      args = parts.slice(1).join(" ");
    }
  }
  exe = exe.replace(/^\\\?\?\\/, "");
  if (!path.isAbsolute(exe)) {
    const sys = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", /\.\w+$/.test(exe) ? exe : `${exe}.exe`);
    if (exists(sys)) exe = sys;
  }
  const base = path.basename(exe).toLowerCase();
  const host = HOSTS.has(base) ? base : null;
  let target = exe;
  if (host) {
    const file = /(?:-file\s+)?"?([a-z]:\\[^"]+?\.(?:dll|ps1|vbs|vbe|js|jse|wsf|hta|bat|cmd|ocx|cpl))"?(?:[\s,]|$)/i.exec(args);
    if (file) target = file[1];
  }
  const lolbin = host && LOLBIN_RISK.test(args) ? base : null;
  return { exe, target, args, host, lolbin };
}

export async function listAutostart({ run = runPowerShell, signal } = {}) {
  const raw = await run(SCRIPT, { timeoutMs: 120_000, signal });
  let list;
  try {
    list = JSON.parse(raw.trim() || "[]");
  } catch {
    return { entries: [], error: "could not read the startup list" };
  }
  if (!Array.isArray(list)) list = [list];
  const entries = list
    .filter((e) => e && e.command)
    .map((e, i) => {
      const parsed = parseCommand(e.command);
      return {
        id: i + 1,
        source: e.source,
        location: e.location,
        name: e.name,
        command: e.command,
        publisher: e.publisher ?? null,
        ...parsed,
        missing: parsed.target ? !fs.existsSync(parsed.target) : true,
      };
    })
    // Built-in Windows services and tasks that run Windows' own files are left out; they would only add noise.
    .filter((e) => !(e.source === "service" || e.source === "task") || !/^[a-z]:\\windows\\/i.test(e.target ?? "") || e.lolbin);
  return { entries, error: null };
}

// Winlogon values that differ from what Windows ships are worth a look on their own.
export function winlogonOdd(entry) {
  if (entry.source !== "winlogon") return false;
  const v = String(entry.command).trim().toLowerCase().replace(/,$/, "");
  if (entry.name === "Shell") return v !== "explorer.exe";
  if (entry.name === "Userinit") return !/^[a-z]:\\windows\\system32\\userinit\.exe$/.test(v);
  return false;
}
