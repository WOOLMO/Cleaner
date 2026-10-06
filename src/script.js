import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { formatSize } from "./ui.js";

const quote = (text) => `'${String(text).replace(/'/g, "''")}'`;
const oneLine = (text) => String(text ?? "").replace(/[\r\n]+/g, " ").trim();

// The real Desktop, which OneDrive often moves (for example to OneDrive\Bureau on a French PC).
export function desktopDir() {
  const r = spawnSync("powershell.exe", [
    "-NoProfile", "-NonInteractive", "-Command",
    "[Console]::OutputEncoding = [Text.Encoding]::UTF8; [Environment]::GetFolderPath('Desktop')",
  ], { encoding: "utf8", windowsHide: true, timeout: 15_000 });
  const found = r.stdout?.trim();
  return found && fs.existsSync(found) ? found : path.join(os.homedir(), "Desktop");
}

const BODY = String.raw`
function Format-Size([double]$b) {
  if ($b -ge 1GB) { return '{0:N2} GB' -f ($b / 1GB) }
  if ($b -ge 1MB) { return '{0:N1} MB' -f ($b / 1MB) }
  return '{0:N0} KB' -f ($b / 1KB)
}
function Get-Free([string]$p) {
  try { return ([IO.DriveInfo]::new([IO.Path]::GetPathRoot($p))).AvailableFreeSpace } catch { return 0 }
}

$todo = @($items | Where-Object { $_ -and (Test-Path -LiteralPath $_.Path) })
Write-Host ''
Write-Host '  cleaner :: removal script' -ForegroundColor Green
Write-Host '  ---------------------------------------------' -ForegroundColor DarkGreen
if ($todo.Count -eq 0) {
  Write-Host '  Nothing left to remove.' -ForegroundColor Green
  return
}
foreach ($i in $todo) { Write-Host ('  {0,10}  {1}' -f (Format-Size $i.Size), $i.Path) -ForegroundColor DarkGreen }
$total = ($todo | Measure-Object -Property Size -Sum).Sum
Write-Host ''
Write-Host ('  {0} items, {1}. Deleted permanently, not moved to the Recycle Bin.' -f $todo.Count, (Format-Size $total)) -ForegroundColor Yellow
$answer = Read-Host '  Delete them now? [y/N]'
if ($answer -notmatch '^\s*y(es)?\s*$') {
  Write-Host '  Nothing was deleted.' -ForegroundColor Green
  return
}
$before = Get-Free $todo[0].Path
$failed = 0
foreach ($i in $todo) {
  Remove-Item -LiteralPath $i.Path -Recurse -Force -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $i.Path) {
    $failed++
    Write-Host ('  [ FAIL ] {0}  (in use or needs admin rights)' -f $i.Path) -ForegroundColor Red
  } else {
    Write-Host ('  [  OK  ] {0}' -f $i.Path) -ForegroundColor Green
  }
}
$after = Get-Free $todo[0].Path
Write-Host ''
Write-Host ('  Done. {0} removed, {1} failed. Freed {2}, {3} free now.' -f ($todo.Count - $failed), $failed, (Format-Size ([math]::Max(0, $after - $before))), (Format-Size $after)) -ForegroundColor Green
`;

export function buildScript(entries, { roots }) {
  const pending = entries.filter((e) => e.status === "pending");
  const safe = pending.filter((e) => e.verdict === "remove");
  const yours = pending.filter((e) => e.verdict === "review");
  const item = (e) => `[pscustomobject]@{ Size = ${e.size}; Path = ${quote(e.path)} }`;
  const note = (e) => `  # ${formatSize(e.size)}  ${oneLine(e.category)}: ${oneLine(e.reason)}`;
  const total = (list) => formatSize(list.reduce((s, e) => s + e.size, 0));

  const text = [
    "# cleaner removal script",
    `# Generated ${new Date().toLocaleString()} from a scan of ${roots.join(", ")}`,
    "#",
    "# Safe items are switched on. Your-call items are switched off: delete the # at the start",
    "# of an item line to include it. Running this lists everything and asks y/N before deleting.",
    "# Deletion is permanent.",
    "",
    "$items = @(",
    `  # ---- safe to remove: ${safe.length} items, ${total(safe)} ----`,
    ...safe.flatMap((e) => [note(e), `  ${item(e)}`]),
    "",
    `  # ---- your call, switched off: ${yours.length} items, ${total(yours)} ----`,
    ...yours.flatMap((e) => [note(e), `  # ${item(e)}`]),
    ")",
    BODY,
  ].join("\r\n").replace(/\r?\n/g, "\r\n");
  return { text, safe: safe.length, yours: yours.length };
}

// Writes cleaner-remove.ps1 (the full delete command) and cleaner-remove.bat (double-click launcher).
export function writeRemovalScript(entries, { dir, roots }) {
  const { text, safe, yours } = buildScript(entries, { roots });
  fs.mkdirSync(dir, { recursive: true });
  const ps1 = path.join(dir, "cleaner-remove.ps1");
  const bat = path.join(dir, "cleaner-remove.bat");
  // Windows PowerShell 5 needs a byte-order mark to read UTF-8 paths correctly.
  fs.writeFileSync(ps1, "﻿" + text + "\r\n", "utf8");
  fs.writeFileSync(bat, [
    "@echo off",
    "title cleaner removal script",
    'powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0cleaner-remove.ps1"',
    "echo.",
    "pause",
    "",
  ].join("\r\n"), "ascii");
  return { ps1, bat, safe, yours };
}
