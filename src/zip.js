import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

// A small ZIP reader: lists entries from the central directory and reads single entries, without
// loading the whole archive. Used to look inside downloaded zips and to unpack the YARA engine.

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

function readAt(fd, offset, length) {
  const buf = Buffer.alloc(length);
  const n = fs.readSync(fd, buf, 0, length, offset);
  return buf.subarray(0, n);
}

export function listZip(file, { maxEntries = 20000 } = {}) {
  const fd = fs.openSync(file, "r");
  try {
    const size = fs.fstatSync(fd).size;
    const tailLen = Math.min(size, 65557);
    const tail = readAt(fd, size - tailLen, tailLen);
    let at = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === EOCD) {
        at = i;
        break;
      }
    }
    if (at < 0) return null;
    const count = tail.readUInt16LE(at + 10);
    const cdSize = tail.readUInt32LE(at + 12);
    const cdOffset = tail.readUInt32LE(at + 16);
    if (cdOffset === 0xffffffff || count === 0xffff) return { entries: [], zip64: true };
    if (cdOffset + cdSize > size) return null;
    const cd = readAt(fd, cdOffset, cdSize);
    const entries = [];
    let p = 0;
    while (p + 46 <= cd.length && entries.length < Math.min(count, maxEntries)) {
      if (cd.readUInt32LE(p) !== CENTRAL) break;
      const flags = cd.readUInt16LE(p + 8);
      const method = cd.readUInt16LE(p + 10);
      const csize = cd.readUInt32LE(p + 20);
      const usize = cd.readUInt32LE(p + 24);
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      const offset = cd.readUInt32LE(p + 42);
      const name = cd.toString(flags & 0x800 ? "utf8" : "latin1", p + 46, p + 46 + nameLen);
      entries.push({ name, size: usize, csize, method, offset, encrypted: Boolean(flags & 1), dir: name.endsWith("/") });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return { entries, zip64: false };
  } finally {
    fs.closeSync(fd);
  }
}

// Reads one entry, at most maxBytes of it. Stored and deflated entries only; others return null.
export function readZipEntry(file, entry, { maxBytes = 4 * 1024 * 1024 } = {}) {
  if (entry.encrypted || entry.dir || (entry.method !== 0 && entry.method !== 8)) return null;
  if (entry.size > maxBytes || entry.csize > maxBytes * 4) return null;
  const fd = fs.openSync(file, "r");
  try {
    const local = readAt(fd, entry.offset, 30);
    if (local.length < 30 || local.readUInt32LE(0) !== LOCAL) return null;
    const start = entry.offset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
    const raw = readAt(fd, start, entry.csize);
    if (entry.method === 0) return raw.subarray(0, maxBytes);
    return zlib.inflateRawSync(raw, { maxOutputLength: maxBytes });
  } catch {
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

// Unpacks the entries a filter accepts into a folder. Names are flattened, so nothing can escape it.
export function extractZip(file, dest, { filter = () => true, maxBytes = 64 * 1024 * 1024 } = {}) {
  const list = listZip(file);
  if (!list) throw new Error("not a zip file");
  fs.mkdirSync(dest, { recursive: true });
  const written = [];
  for (const e of list.entries) {
    if (e.dir || !filter(e)) continue;
    const data = readZipEntry(file, e, { maxBytes });
    if (!data) continue;
    const out = path.join(dest, path.basename(e.name.replace(/\\/g, "/")));
    fs.writeFileSync(out, data);
    written.push(out);
  }
  return written;
}
