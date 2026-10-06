import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { buildScript, writeRemovalScript } from "../src/script.js";

const entries = [
  { id: 1, status: "pending", verdict: "remove", size: 5000, category: "temp-file", path: "C:\\Users\\x\\Downloads\\Rapport d'été 🎵.crdownload", reason: "Unfinished download" },
  { id: 2, status: "pending", verdict: "review", size: 9000, category: "installer", path: "C:\\Users\\x\\Downloads\\setup.exe", reason: "Old installer" },
  { id: 3, status: "removed", verdict: "remove", size: 1, category: "x", path: "C:\\gone.tmp", reason: "already removed" },
];

test("safe items are switched on, your-call items are commented out, removed items are left out", () => {
  const { text, safe, yours } = buildScript(entries, { roots: ["C:\\Users\\x"] });
  assert.equal(safe, 1);
  assert.equal(yours, 1);
  assert.match(text, /\n  \[pscustomobject\]@\{ Size = 5000; Path = 'C:\\Users\\x\\Downloads\\Rapport d''été 🎵\.crdownload' \}/);
  assert.match(text, /\n  # \[pscustomobject\]@\{ Size = 9000;/);
  assert.doesNotMatch(text, /gone\.tmp/);
});

test("the generated script is valid PowerShell and asks before deleting", { skip: process.platform !== "win32" }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cleaner-script-"));
  const { ps1, bat } = writeRemovalScript(entries, { dir, roots: ["C:\\Users\\x"] });
  const check = spawnSync("powershell.exe", [
    "-NoProfile", "-NonInteractive", "-Command",
    `$e = $null; [void][System.Management.Automation.Language.Parser]::ParseFile('${ps1.replace(/'/g, "''")}', [ref]$null, [ref]$e); $e.Count`,
  ], { encoding: "utf8" });
  assert.equal(check.stdout.trim(), "0");
  assert.match(fs.readFileSync(ps1, "utf8"), /Read-Host '  Delete them now\? \[y\/N\]'/);
  assert.equal(fs.readFileSync(ps1)[0], 0xef, "starts with a UTF-8 byte-order mark");
  assert.match(fs.readFileSync(bat, "utf8"), /-File "%~dp0cleaner-remove\.ps1"/);
  fs.rmSync(dir, { recursive: true, force: true });
});
