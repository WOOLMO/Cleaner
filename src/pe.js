import fs from "node:fs";

// A small reader for Windows programs (PE files): headers, sections, imports, and whether a signature is
// embedded. It reads only the parts it needs, so a 2 GB installer costs a few kilobytes of I/O.

const MAX_SECTIONS = 96;
const MAX_IMPORT_DLLS = 256;
const MAX_IMPORTS = 4000;
const ENTROPY_SAMPLE = 1024 * 1024;

export function entropy(buf) {
  if (!buf.length) return 0;
  const counts = new Uint32Array(256);
  for (const b of buf) counts[b]++;
  let h = 0;
  for (const c of counts) {
    if (!c) continue;
    const p = c / buf.length;
    h -= p * Math.log2(p);
  }
  return h;
}

// The source is an open file descriptor or a Buffer already in memory.
function readAt(src, offset, length) {
  if (Buffer.isBuffer(src)) return src.subarray(Math.min(offset, src.length), Math.min(offset + length, src.length));
  const buf = Buffer.alloc(length);
  const n = fs.readSync(src, buf, 0, length, offset);
  return buf.subarray(0, n);
}

function cString(buf, offset, max = 256) {
  let end = offset;
  while (end < buf.length && end - offset < max && buf[end] !== 0) end++;
  return buf.toString("latin1", offset, end);
}

// Parses a PE from an open file descriptor or a Buffer. Returns null when it is not a PE.
export function parsePE(fd, fileSize = Buffer.isBuffer(fd) ? fd.length : 0) {
  const dos = readAt(fd, 0, 64);
  if (dos.length < 64 || dos.readUInt16LE(0) !== 0x5a4d) return null;
  const peOffset = dos.readUInt32LE(0x3c);
  if (peOffset <= 0 || peOffset > Math.min(fileSize - 24, 64 * 1024)) return null;
  const head = readAt(fd, peOffset, 24 + 240);
  if (head.length < 24 || head.readUInt32LE(0) !== 0x00004550) return null;

  const machine = head.readUInt16LE(4);
  const sectionCount = Math.min(head.readUInt16LE(6), MAX_SECTIONS);
  const timestamp = head.readUInt32LE(8);
  const optSize = head.readUInt16LE(20);
  const characteristics = head.readUInt16LE(22);
  const opt = readAt(fd, peOffset + 24, optSize);
  if (opt.length < 2) return null;
  const magic = opt.readUInt16LE(0);
  const is64 = magic === 0x20b;
  if (magic !== 0x10b && magic !== 0x20b) return null;
  const subsystem = opt.length > 70 ? opt.readUInt16LE(68) : 0;
  const dirStart = is64 ? 112 : 96;
  const dirCount = opt.length >= dirStart ? Math.min(opt.readUInt32LE(dirStart - 4), 16) : 0;
  const dir = (i) => (i < dirCount && opt.length >= dirStart + i * 8 + 8 ? { rva: opt.readUInt32LE(dirStart + i * 8), size: opt.readUInt32LE(dirStart + i * 8 + 4) } : { rva: 0, size: 0 });

  const table = readAt(fd, peOffset + 24 + optSize, sectionCount * 40);
  const sections = [];
  let endOfImage = 0;
  for (let i = 0; i + 40 <= table.length; i += 40) {
    const flags = table.readUInt32LE(i + 36);
    const s = {
      name: cString(table, i, 8),
      virtualSize: table.readUInt32LE(i + 8),
      rva: table.readUInt32LE(i + 12),
      rawSize: table.readUInt32LE(i + 16),
      rawOffset: table.readUInt32LE(i + 20),
      exec: Boolean(flags & 0x20000000),
      write: Boolean(flags & 0x80000000),
      entropy: 0,
    };
    if (s.rawSize && s.rawOffset < fileSize) {
      s.entropy = entropy(readAt(fd, s.rawOffset, Math.min(s.rawSize, ENTROPY_SAMPLE)));
      endOfImage = Math.max(endOfImage, s.rawOffset + s.rawSize);
    }
    sections.push(s);
  }

  const toOffset = (rva) => {
    for (const s of sections) {
      const span = Math.max(s.virtualSize, s.rawSize);
      if (rva >= s.rva && rva < s.rva + span) return rva - s.rva + s.rawOffset;
    }
    return -1;
  };

  // Imported functions, by DLL. Ordinal-only imports are skipped; they carry no name to judge.
  const imports = {};
  let importCount = 0;
  const imp = dir(1);
  const impOffset = imp.rva ? toOffset(imp.rva) : -1;
  if (impOffset > 0) {
    const descriptors = readAt(fd, impOffset, 20 * MAX_IMPORT_DLLS);
    for (let i = 0; i + 20 <= descriptors.length && importCount < MAX_IMPORTS; i += 20) {
      const lookupRva = descriptors.readUInt32LE(i) || descriptors.readUInt32LE(i + 16);
      const nameRva = descriptors.readUInt32LE(i + 12);
      if (!nameRva && !lookupRva) break;
      const nameOffset = toOffset(nameRva);
      if (nameOffset < 0) continue;
      const dll = cString(readAt(fd, nameOffset, 256), 0).toLowerCase();
      const funcs = [];
      const lookupOffset = toOffset(lookupRva);
      if (lookupOffset >= 0) {
        const width = is64 ? 8 : 4;
        const thunks = readAt(fd, lookupOffset, width * 1024);
        for (let t = 0; t + width <= thunks.length && importCount < MAX_IMPORTS; t += width) {
          const low = thunks.readUInt32LE(t);
          const high = is64 ? thunks.readUInt32LE(t + 4) : 0;
          if (!low && !high) break;
          const byOrdinal = is64 ? Boolean(high & 0x80000000) : Boolean(low & 0x80000000);
          if (byOrdinal) continue;
          const hintOffset = toOffset(low & 0x7fffffff);
          if (hintOffset < 0) continue;
          funcs.push(cString(readAt(fd, hintOffset + 2, 128), 0));
          importCount++;
        }
      }
      imports[dll] = funcs;
    }
  }

  // where execution starts: normally inside the code section
  const entry = opt.length >= 20 ? opt.readUInt32LE(16) : 0;
  const entryIndex = entry ? sections.findIndex((s) => entry >= s.rva && entry < s.rva + Math.max(s.virtualSize, s.rawSize)) : -1;
  const security = dir(4);
  return {
    entry,
    entrySection: entryIndex >= 0 ? { name: sections[entryIndex].name, exec: sections[entryIndex].exec, last: entryIndex === sections.length - 1, entropy: sections[entryIndex].entropy } : null,
    is64,
    machine,
    dll: Boolean(characteristics & 0x2000),
    subsystem: subsystem === 2 ? "gui" : subsystem === 3 ? "console" : subsystem === 1 ? "native" : "other",
    timestamp,
    sections,
    imports,
    importCount,
    dotnet: dir(14).rva > 0,
    // The certificate table is the only data directory that holds a file offset instead of an RVA.
    hasSignature: security.rva > 0 && security.size > 8 && security.rva + security.size <= fileSize,
    overlay: Math.max(0, (security.rva > 0 ? Math.min(fileSize, security.rva) : fileSize) - endOfImage),
  };
}

export function readPE(file, size) {
  let fd;
  try {
    fd = fs.openSync(file, "r");
    return parsePE(fd, size ?? fs.fstatSync(fd).size);
  } catch {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

// All imported function names, lower case, for quick lookups.
export function importSet(pe) {
  const set = new Set();
  if (!pe) return set;
  for (const funcs of Object.values(pe.imports)) for (const f of funcs) set.add(f.toLowerCase());
  return set;
}
