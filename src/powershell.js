import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

// Runs a read-only PowerShell script and returns stdout. The script goes through a temporary .ps1 file:
// piping multi-line scripts into "-Command -" silently drops blocks that span lines.
export function runPowerShell(script, { timeoutMs = 60_000, signal } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cleaner-ps-"));
  const file = path.join(dir, "query.ps1");
  // A byte order mark makes Windows PowerShell 5.1 read the file as UTF-8.
  fs.writeFileSync(file, "﻿[Console]::OutputEncoding = [Text.Encoding]::UTF8\r\n" + script + "\r\n", "utf8");
  const cleanup = () => fs.rmSync(dir, { recursive: true, force: true });
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", file], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill(), timeoutMs);
    const onAbort = () => child.kill();
    signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.setEncoding("utf8").on("data", (d) => (out += d));
    child.stderr.setEncoding("utf8").on("data", (d) => (err += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      cleanup();
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      cleanup();
      if (signal?.aborted) reject(signal.reason);
      else if (code !== 0 && !out.trim()) reject(new Error(err.trim().split("\n")[0] || `powershell exited with ${code}`));
      else resolve(out);
    });
  });
}

// Quotes a value for a single-quoted PowerShell string.
export const psQuote = (s) => `'${String(s).replace(/'/g, "''")}'`;
