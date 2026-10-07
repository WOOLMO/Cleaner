import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DATA_DIR } from "./config.js";

// Append-only activity log: every change cleaner makes to the disk, who made it, from which machine and app.
// One JSON object per line, so it can be shipped to a log collector as is.
export const AUDIT_FILE = path.join(DATA_DIR, "audit.jsonl");
const MAX_ITEMS_LOGGED = 1000;

export function audit(action, { app = "cli", items, ...details } = {}) {
  const entry = {
    time: new Date().toISOString(),
    action,
    app,
    user: os.userInfo().username,
    machine: os.hostname(),
    ...details,
  };
  if (items) {
    entry.count = items.length;
    entry.bytes = items.reduce((sum, i) => sum + (i.size || 0), 0);
    entry.items = items.slice(0, MAX_ITEMS_LOGGED).map((i) => ({ path: i.path, size: i.size, result: i.result ?? i.status }));
    if (items.length > MAX_ITEMS_LOGGED) entry.truncated = true;
  }
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.appendFileSync(AUDIT_FILE, JSON.stringify(entry) + "\n", "utf8");
  } catch {
    // The log must never block the action itself.
  }
  return entry;
}

// Newest first.
export function readAudit({ limit = 500 } = {}) {
  if (!fs.existsSync(AUDIT_FILE)) return [];
  const lines = fs.readFileSync(AUDIT_FILE, "utf8").split("\n").filter(Boolean);
  const out = [];
  for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
    try {
      out.push(JSON.parse(lines[i]));
    } catch {
      // skip a damaged line
    }
  }
  return out;
}
