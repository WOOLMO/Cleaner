import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DATA_DIR } from "./config.js";

// Quarantine: a file is moved into Cleaner's data folder with every byte XOR-scrambled, so it can't run
// and antivirus software doesn't keep re-detecting it. Restore unscrambles it back to where it was.

export const QUARANTINE_DIR = path.join(DATA_DIR, "quarantine");
const KEY = 0xa5;
const CHUNK = 1024 * 1024;

function xorCopy(src, dest) {
  const input = fs.openSync(src, "r");
  const output = fs.openSync(dest, "wx");
  try {
    const buf = Buffer.allocUnsafe(CHUNK);
    for (;;) {
      const n = fs.readSync(input, buf, 0, CHUNK, null);
      if (!n) break;
      for (let i = 0; i < n; i++) buf[i] ^= KEY;
      fs.writeSync(output, buf, 0, n);
    }
  } finally {
    fs.closeSync(input);
    fs.closeSync(output);
  }
}

export function quarantineFile(file, { reason = null, sha256 = null, severity = null } = {}) {
  const original = path.resolve(file);
  const st = fs.statSync(original);
  if (!st.isFile()) throw new Error("only files can be quarantined");
  const id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomBytes(3).toString("hex")}`;
  const dir = path.join(QUARANTINE_DIR, id);
  fs.mkdirSync(dir, { recursive: true });
  const payload = path.join(dir, "payload.bin");
  try {
    xorCopy(original, payload);
    fs.unlinkSync(original);
  } catch (err) {
    fs.rmSync(dir, { recursive: true, force: true });
    if (err.code === "EBUSY" || err.code === "EPERM" || err.code === "EACCES") throw new Error("the file is in use or protected; close the program using it and try again");
    throw err;
  }
  const meta = { id, original, size: st.size, sha256, reason, severity, time: new Date().toISOString() };
  fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(meta, null, 2), "utf8");
  return meta;
}

export function listQuarantine() {
  if (!fs.existsSync(QUARANTINE_DIR)) return [];
  const out = [];
  for (const id of fs.readdirSync(QUARANTINE_DIR)) {
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(QUARANTINE_DIR, id, "meta.json"), "utf8"));
      if (fs.existsSync(path.join(QUARANTINE_DIR, id, "payload.bin"))) out.push(meta);
    } catch {
      // half-written entry: ignore
    }
  }
  return out.sort((a, b) => b.time.localeCompare(a.time));
}

const entryDir = (id) => {
  const clean = String(id).replace(/[^\w-]/g, "");
  if (!clean) throw new Error("unknown quarantine entry");
  return path.join(QUARANTINE_DIR, clean);
};

export function restoreQuarantined(id) {
  const dir = entryDir(id);
  const meta = JSON.parse(fs.readFileSync(path.join(dir, "meta.json"), "utf8"));
  if (fs.existsSync(meta.original)) throw new Error("a file with that name is back in its place; move it first");
  fs.mkdirSync(path.dirname(meta.original), { recursive: true });
  xorCopy(path.join(dir, "payload.bin"), meta.original);
  fs.rmSync(dir, { recursive: true, force: true });
  return meta;
}

export function deleteQuarantined(id) {
  const dir = entryDir(id);
  const meta = JSON.parse(fs.readFileSync(path.join(dir, "meta.json"), "utf8"));
  fs.rmSync(dir, { recursive: true, force: true });
  return meta;
}
