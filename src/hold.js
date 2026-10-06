import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./config.js";

// The holding area: items are moved here instead of deleted, so they can be put back.
// Moving within one drive is an instant rename. Space is only freed by purge.
export const HOLD_DIR = path.join(DATA_DIR, "hold");
const MANIFEST = "manifest.tsv";

const driveOf = (p) => path.parse(path.resolve(p)).root.toLowerCase();

export function holdItems(entries) {
  const batch = new Date().toISOString().replace(/[:.]/g, "-");
  const itemsDir = path.join(HOLD_DIR, batch, "items");
  fs.mkdirSync(itemsDir, { recursive: true });
  const rows = [];
  for (const e of entries) {
    if (driveOf(e.path) !== driveOf(HOLD_DIR)) {
      e.status = "failed";
      e.note = `on another drive than ${driveOf(HOLD_DIR)}`;
      continue;
    }
    const dest = path.join(itemsDir, `${String(e.id).padStart(4, "0")}-${path.basename(e.path)}`);
    try {
      fs.renameSync(e.path, dest);
      e.status = "held";
      rows.push([e.size, e.path, dest].join("\t"));
    } catch (err) {
      e.status = "failed";
      e.note = err.code === "EPERM" || err.code === "EBUSY" ? "in use" : err.code;
    }
  }
  fs.writeFileSync(path.join(HOLD_DIR, batch, MANIFEST), rows.join("\r\n") + (rows.length ? "\r\n" : ""), "utf8");
  if (!rows.length) fs.rmSync(path.join(HOLD_DIR, batch), { recursive: true, force: true });
  return { batch, held: rows.length };
}

export function listHeld() {
  if (!fs.existsSync(HOLD_DIR)) return [];
  const held = [];
  for (const batch of fs.readdirSync(HOLD_DIR).sort()) {
    const manifest = path.join(HOLD_DIR, batch, MANIFEST);
    if (!fs.existsSync(manifest)) continue;
    for (const line of fs.readFileSync(manifest, "utf8").split(/\r?\n/)) {
      if (!line) continue;
      const [size, original, heldAt] = line.split("\t");
      if (fs.existsSync(heldAt)) held.push({ batch, size: Number(size), original, held: heldAt });
    }
  }
  return held;
}

// Removes batch folders whose items are all gone (restored or purged).
function tidyBatches() {
  if (!fs.existsSync(HOLD_DIR)) return;
  for (const batch of fs.readdirSync(HOLD_DIR)) {
    const itemsDir = path.join(HOLD_DIR, batch, "items");
    if (!fs.existsSync(itemsDir) || fs.readdirSync(itemsDir).length === 0) {
      fs.rmSync(path.join(HOLD_DIR, batch), { recursive: true, force: true });
    }
  }
}

export function restoreHeld(items) {
  const result = { restored: [], conflicts: [], failed: [] };
  for (const item of items) {
    if (fs.existsSync(item.original)) {
      result.conflicts.push(item);
      continue;
    }
    try {
      fs.mkdirSync(path.dirname(item.original), { recursive: true });
      fs.renameSync(item.held, item.original);
      result.restored.push(item);
    } catch {
      result.failed.push(item);
    }
  }
  tidyBatches();
  return result;
}

export function purgeHeld(items) {
  const result = { purged: [], failed: [] };
  for (const item of items) {
    try {
      fs.rmSync(item.held, { recursive: true, force: true, maxRetries: 2 });
    } catch {
      // checked below
    }
    (fs.existsSync(item.held) ? result.failed : result.purged).push(item);
  }
  tidyBatches();
  return result;
}
