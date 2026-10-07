import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { runPowerShell } from "./powershell.js";
import { placeOf, indicatorHits, searchable, decodeEncodedCommand } from "./threat-rules.js";

// What the PC is doing right now: running programs, their network connections, and loaded drivers.
// A snapshot, read-only. Rules look for what malware does rather than what it looks like:
// fake system processes, Office starting shells, hidden encoded commands, programs running from temp
// folders, connections to known botnet servers, and drivers known to be abused.

const SNAPSHOT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
$procs = Get-CimInstance Win32_Process | ForEach-Object {
  [pscustomobject]@{ pid = [int]$_.ProcessId; ppid = [int]$_.ParentProcessId; name = [string]$_.Name; path = [string]$_.ExecutablePath; cmd = [string]$_.CommandLine; started = $(if ($_.CreationDate) { $_.CreationDate.ToString('o') } else { $null }) } }
$conns = Get-NetTCPConnection -State Established,Listen | ForEach-Object {
  [pscustomobject]@{ pid = [int]$_.OwningProcess; state = [string]$_.State; local = [string]$_.LocalAddress; lport = [int]$_.LocalPort; remote = [string]$_.RemoteAddress; rport = [int]$_.RemotePort } }
$drivers = Get-CimInstance Win32_SystemDriver | Where-Object { $_.State -eq 'Running' } | ForEach-Object {
  [pscustomobject]@{ name = [string]$_.Name; path = [string]$_.PathName; display = [string]$_.DisplayName } }
[pscustomobject]@{ processes = @($procs); connections = @($conns); drivers = @($drivers) } | ConvertTo-Json -Compress -Depth 4
`;

export async function snapshot({ run = runPowerShell, signal } = {}) {
  const raw = await run(SNAPSHOT, { timeoutMs: 90_000, signal });
  const data = JSON.parse(raw.trim() || "{}");
  const arr = (x) => (Array.isArray(x) ? x : x ? [x] : []);
  return { processes: arr(data.processes), connections: arr(data.connections), drivers: arr(data.drivers) };
}

const WINDIR = (process.env.SystemRoot ?? "C:\\Windows").toLowerCase();
// Windows processes and where they live. Anything else using these names is pretending.
const SYSTEM_NAMES = {
  "svchost.exe": ["system32", "syswow64"],
  "lsass.exe": ["system32"],
  "csrss.exe": ["system32"],
  "winlogon.exe": ["system32"],
  "services.exe": ["system32"],
  "smss.exe": ["system32"],
  "wininit.exe": ["system32"],
  "spoolsv.exe": ["system32"],
  "taskhostw.exe": ["system32"],
  "dwm.exe": ["system32"],
  "conhost.exe": ["system32"],
  "rundll32.exe": ["system32", "syswow64"],
  "explorer.exe": [""],
  "lsm.exe": ["system32"],
  "dllhost.exe": ["system32", "syswow64"],
  "sihost.exe": ["system32"],
  "ctfmon.exe": ["system32", "syswow64"],
  "searchindexer.exe": ["system32"],
};
const OFFICE = new Set(["winword.exe", "excel.exe", "powerpnt.exe", "outlook.exe", "onenote.exe", "msaccess.exe", "mspub.exe", "visio.exe"]);
const SHELLS = new Set(["powershell.exe", "pwsh.exe", "cmd.exe", "wscript.exe", "cscript.exe", "mshta.exe", "rundll32.exe", "regsvr32.exe", "certutil.exe", "bitsadmin.exe", "schtasks.exe", "wmic.exe", "msbuild.exe", "installutil.exe"]);
const SCRIPT_HOSTS = new Set(["wscript.exe", "cscript.exe", "mshta.exe"]);

export function isPrivateIp(ip) {
  return /^(10\.|127\.|192\.168\.|169\.254\.|0\.0\.0\.0|::$|::1$|fe80:|fc|fd)/i.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
}

export function driverPath(raw) {
  let p = String(raw ?? "").trim().replace(/^"|"$/g, "");
  p = p.replace(/^\\\?\?\\/, "").replace(/^\\SystemRoot\\/i, `${WINDIR}\\`);
  if (/^system32\\/i.test(p)) p = path.join(WINDIR, p);
  return p;
}

// Pure judgment of one process, given what else is running and what it talks to.
export function judgeProcess(p, { parent = null, signer = null, connections = [], intel = null, exists = fs.existsSync } = {}) {
  const findings = [];
  const detections = [];
  const add = (id, weight, label, detail = null) => findings.push({ id, weight, label, detail, counted: true });
  const name = (p.name ?? "").toLowerCase();
  // some processes report their path with the \\?\ long-path prefix
  const file = (p.path ?? "").replace(/^\\\\\?\\/, "");
  const lower = file.toLowerCase();
  const place = file ? placeOf(file) : {};

  const homes = SYSTEM_NAMES[name];
  if (homes && file) {
    const ok = homes.some((dir) => lower === path.join(WINDIR, dir, name).toLowerCase());
    if (!ok) add("masquerade", 6, `Uses the name of a Windows process (${p.name}) from the wrong folder`, file);
  }
  if (file && (place.temp || place.downloads || place.publicUser || place.startup)) add("runs-from-odd-place", 2, place.temp ? "Running from a temp folder" : place.downloads ? "Running straight from Downloads" : place.startup ? "Running from the Startup folder" : "Running from the shared Public folder");
  if (file && place.roaming && /\\appdata\\roaming\\[^\\]+\.exe$/i.test(file)) add("runs-from-roaming-root", 2, "Running from the top of AppData\\Roaming, a classic malware spot");
  if (file && !exists(file)) add("image-deleted", 3, "Its program file was deleted after it started");
  if (signer?.status === "invalid") add("signature-broken", 5, "Its digital signature is broken");
  else if (signer?.status === "none" && file && !lower.startsWith(WINDIR)) add("unsigned", 1, "Not digitally signed");

  const parentName = (parent?.name ?? "").toLowerCase();
  if (OFFICE.has(parentName) && SHELLS.has(name)) add("office-child", 5, `${parent.name} started ${p.name}, a common macro-malware move`);
  else if (SCRIPT_HOSTS.has(parentName) && SHELLS.has(name)) add("script-child", 3, `${parent.name} started ${p.name}`);

  const cmd = p.cmd ?? "";
  const decoded = decodeEncodedCommand(cmd);
  const text = searchable(Buffer.from(`${cmd}\n${decoded ?? ""}`));
  const hits = indicatorHits(text);
  if (decoded) add("encoded-command", 3, "Runs a hidden, encoded PowerShell command", decoded.replace(/\s+/g, " ").slice(0, 160));
  if (hits.downloadExec) add("download-exec", 3, "Downloads and runs code from the internet");
  if (hits.evasion) add("evasion", 5, "Turns off security features or deletes backups");
  if (hits.hidden && (name === "powershell.exe" || name === "pwsh.exe") && /-(ep|exec|executionpolicy)\s+bypass/i.test(cmd)) add("hidden-bypass", 2, "Hidden PowerShell that skips the script policy");

  const external = connections.filter((c) => c.state === "Established" && c.remote && !isPrivateIp(c.remote));
  const listening = connections.filter((c) => c.state === "Listen" && (c.local === "0.0.0.0" || c.local === "::"));
  for (const c of external) {
    const c2 = intel?.ips.get(c.remote);
    if (c2) detections.push({ source: "feodo", name: `Connected to a known botnet server ${c.remote}:${c.rport}${c2.malware ? ` (${c2.malware})` : ""}` });
  }
  const shady = findings.some((f) => ["runs-from-odd-place", "runs-from-roaming-root", "masquerade", "image-deleted"].includes(f.id)) || signer?.status === "none";
  if (external.length && shady && file && !lower.startsWith(WINDIR)) add("phones-out", 2, `Talks to ${external.length} internet address${external.length === 1 ? "" : "es"}`, [...new Set(external.map((c) => c.remote))].slice(0, 4).join(", "));
  if (listening.length && shady && file && !lower.startsWith(WINDIR)) add("listens", 2, `Waits for incoming connections on port ${listening.map((c) => c.lport).slice(0, 3).join(", ")}`);

  const score = findings.reduce((s, f) => s + f.weight, 0);
  const severity = detections.length ? "threat" : score >= 6 ? "suspicious" : score >= 4 ? "notice" : "clean";
  return { findings, detections, score, severity, external: external.length, listening: listening.map((c) => c.lport) };
}

export function sha256Small(file, max = 64 * 1024 * 1024) {
  try {
    const st = fs.statSync(file);
    if (st.size > max) return null;
    return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  } catch {
    return null;
  }
}

export function judgeDriver(d, { intel = null, hash = sha256Small } = {}) {
  const file = driverPath(d.path);
  const sha256 = file ? hash(file) : null;
  const known = sha256 ? intel?.drivers.get(sha256) : null;
  if (!known) return { name: d.name, display: d.display, path: file, sha256, severity: "clean", label: null };
  return {
    name: d.name,
    display: d.display,
    path: file,
    sha256,
    severity: known.malicious ? "threat" : "suspicious",
    label: known.malicious ? `A known malicious driver (LOLDrivers: ${known.name})` : `A driver known to be abused to switch off security software (LOLDrivers: ${known.name})`,
  };
}

// The whole picture: every process judged with its parent and connections, every running driver hashed.
export function analyzeBehavior(snap, { signers = new Map(), intel = null, exists = fs.existsSync, hash = sha256Small } = {}) {
  const byPid = new Map(snap.processes.map((p) => [p.pid, p]));
  const connsBy = new Map();
  for (const c of snap.connections) (connsBy.get(c.pid) ?? connsBy.set(c.pid, []).get(c.pid)).push(c);
  const processes = [];
  for (const p of snap.processes) {
    if (!p.pid || p.pid <= 4) continue;
    const verdict = judgeProcess(p, { parent: byPid.get(p.ppid) ?? null, signer: p.path ? signers.get(p.path.toLowerCase()) ?? null : null, connections: connsBy.get(p.pid) ?? [], intel, exists });
    processes.push({ pid: p.pid, ppid: p.ppid, name: p.name, path: p.path || null, cmd: p.cmd || null, parentName: byPid.get(p.ppid)?.name ?? null, started: p.started ?? null, signer: p.path ? signers.get(p.path.toLowerCase()) ?? null : null, ...verdict });
  }
  const drivers = snap.drivers.map((d) => judgeDriver(d, { intel, hash }));
  const external = snap.connections.filter((c) => c.state === "Established" && c.remote && !isPrivateIp(c.remote));
  return {
    processes: processes.filter((p) => p.severity !== "clean").sort((a, b) => b.score - a.score),
    drivers: drivers.filter((d) => d.severity !== "clean"),
    stats: {
      processes: processes.length,
      external: external.length,
      listening: snap.connections.filter((c) => c.state === "Listen").length,
      drivers: drivers.length,
      talkers: new Set(external.map((c) => c.pid)).size,
    },
  };
}
