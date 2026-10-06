import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Per-user data (database, settings, holding area) lives outside the install folder, so updates never wipe it.
export const DATA_DIR = process.env.CLEANER_HOME
  || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "cleaner");

export const DEFAULTS = {
  db: path.join(DATA_DIR, "cleaner-db.txt"),
  // Flash-Lite has the most generous free-tier limits; the others are fallbacks when it is busy.
  models: ["gemini-flash-lite-latest", "gemini-flash-latest", "gemini-2.5-flash-lite"],
  maxAi: 400,
  batchSize: 40,
  largeFileMB: 200,
  dupeMinMB: 1,
};

export const ENV_FILES = [path.join(DATA_DIR, ".env"), path.join(ROOT, ".env")];

// Reads KEY=value lines. Real environment variables win, then the per-user .env, then one next to the code.
export function loadEnv() {
  for (const file of ENV_FILES) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      if (line.trimStart().startsWith("#")) continue;
      const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (!match) continue;
      const value = match[2].replace(/^(['"])(.*)\1$/, "$2");
      if (process.env[match[1]] === undefined) process.env[match[1]] = value;
    }
  }
}

export function saveSetting(key, value) {
  const file = ENV_FILES[0];
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const lines = fs.existsSync(file) ? fs.readFileSync(file, "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith(`${key}=`)) : [];
  lines.push(`${key}=${value}`);
  fs.writeFileSync(file, lines.join("\r\n") + "\r\n", "utf8");
  return file;
}

// Version 0.x kept the database next to the code. Copy it over once so `cleaner clean` still finds it.
export function migrateOldDb() {
  const old = path.join(ROOT, "cleaner-db.txt");
  if (fs.existsSync(old) && !fs.existsSync(DEFAULTS.db)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.copyFileSync(old, DEFAULTS.db);
  }
}
