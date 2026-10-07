import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./engine.js";

// Diagnostic log for support: %LOCALAPPDATA%\cleaner\logs\desktop.log, rotated at 5 MB.
const DIR = path.join(DATA_DIR, "logs");
const FILE = path.join(DIR, "desktop.log");
const MAX = 5 * 1024 * 1024;

function write(level, parts) {
  const line = `${new Date().toISOString()} ${level.padEnd(5)} ${parts.map((p) => (p instanceof Error ? p.stack : typeof p === "string" ? p : JSON.stringify(p))).join(" ")}\n`;
  try {
    fs.mkdirSync(DIR, { recursive: true });
    if (fs.existsSync(FILE) && fs.statSync(FILE).size > MAX) fs.renameSync(FILE, `${FILE}.1`);
    fs.appendFileSync(FILE, line, "utf8");
  } catch {
    // logging must never break the app
  }
  if (!process.env.CLEANER_QUIET) process.stdout.write(line);
}

export const log = {
  info: (...p) => write("info", p),
  warn: (...p) => write("warn", p),
  error: (...p) => write("error", p),
  file: FILE,
};
