import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PROTECTED = [
  /^[a-z]:\\windows(\\|$)/i,
  /^[a-z]:\\program files( \(x86\))?(\\|$)/i,
  /^[a-z]:\\programdata(\\|$)/i,
];

// Last line of defence: never delete a drive root, a top-level folder, the home folder or system folders.
export function isSafeToRemove(target) {
  const full = path.resolve(target);
  const parts = full.split(/[\\/]+/).filter(Boolean);
  if (parts.length < 3) return false;
  if (full.toLowerCase() === os.homedir().toLowerCase()) return false;
  return !PROTECTED.some((re) => re.test(full));
}

export function removePermanently(target) {
  try {
    fs.rmSync(target, { recursive: true, force: true, maxRetries: 2, retryDelay: 200 });
  } catch {
    // reported below by checking whether it is still there
  }
  return !fs.existsSync(target);
}

export function freeBytes(target) {
  try {
    const s = fs.statfsSync(path.parse(path.resolve(target)).root);
    return s.bavail * s.bsize;
  } catch {
    return null;
  }
}
