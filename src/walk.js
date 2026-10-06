import fsp from "node:fs/promises";
import path from "node:path";

// File lookups per folder are done in chunks, so a folder with 100,000 files (WinSxS) doesn't flood memory.
const STAT_CHUNK = 256;

// Reads one folder: its subfolders, and its files with size and modified time. Links and junctions are skipped,
// so a link that points back up the tree can never cause a loop.
// light: only totals (bytes, count, newest) instead of one object per file. Used for sizing.
export async function readDir(dir, { light = false } = {}) {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  const dirs = [];
  const names = [];
  for (const e of entries) {
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) dirs.push({ name: e.name, path: path.join(dir, e.name) });
    else if (e.isFile()) names.push(e.name);
  }

  const files = [];
  let bytes = 0;
  let count = 0;
  let newest = 0;
  for (let i = 0; i < names.length; i += STAT_CHUNK) {
    await Promise.all(names.slice(i, i + STAT_CHUNK).map((name) => {
      const p = path.join(dir, name);
      return fsp.stat(p).then((st) => {
        if (light) {
          bytes += st.size;
          count++;
          if (st.mtimeMs > newest) newest = st.mtimeMs;
        } else {
          files.push({ name, path: p, size: st.size, mtimeMs: st.mtimeMs });
        }
      }, () => {});
    }));
  }
  return light ? { dir, dirs, bytes, count, newest } : { dir, dirs, files };
}

// Walks folder trees with many folders in flight. On Windows this is about 5x faster than one folder at a time,
// because file metadata calls run in parallel on libuv's thread pool.
// visit(job, listing) returns the jobs to walk next. listing is null when a folder can't be read.
export function walk(jobs, visit, { concurrency = 48, light = false } = {}) {
  const queue = [...jobs];
  let active = 0;
  let failed = false;
  return new Promise((resolve, reject) => {
    const pump = () => {
      if (failed) return;
      if (!queue.length && !active) {
        resolve();
        return;
      }
      while (active < concurrency && queue.length) {
        const job = queue.pop();
        active++;
        readDir(job.dir, { light })
          .then((listing) => visit(job, listing))
          .then(
            (children) => {
              if (children) for (const child of children) queue.push(child);
              active--;
              pump();
            },
            (err) => {
              failed = true;
              reject(err);
            },
          );
      }
    };
    pump();
  });
}

// Adds up a whole folder without classifying anything inside it.
export async function treeSize(dir, { concurrency = 32 } = {}) {
  let size = 0;
  let files = 0;
  let newest = 0;
  let unreadable = 0;
  await walk([{ dir }], (job, listing) => {
    if (!listing) {
      unreadable++;
      return null;
    }
    size += listing.bytes;
    files += listing.count;
    if (listing.newest > newest) newest = listing.newest;
    return listing.dirs.map((d) => ({ dir: d.path }));
  }, { concurrency, light: true });
  return { size, files, newest, unreadable };
}
