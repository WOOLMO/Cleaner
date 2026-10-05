import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const DEFAULTS = {
  db: path.join(ROOT, "cleaner-db.txt"),
  // Flash-Lite has the most generous free-tier limits; the others are fallbacks when it is busy.
  models: ["gemini-flash-lite-latest", "gemini-flash-latest", "gemini-2.5-flash-lite"],
  maxAi: 400,
  batchSize: 40,
  largeFileMB: 200,
  dupeMinMB: 1,
};

// Reads KEY=value lines from .env next to package.json. Real environment variables win.
export function loadEnv() {
  const file = path.join(ROOT, ".env");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    if (line.trimStart().startsWith("#")) continue;
    const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    const value = match[2].replace(/^(['"])(.*)\1$/, "$2");
    if (process.env[match[1]] === undefined) process.env[match[1]] = value;
  }
}
