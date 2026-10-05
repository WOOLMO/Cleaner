import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const DAY = 86_400_000;
const MB = 1024 * 1024;

// System folders at the top of a drive. A cleanup tool never walks into these.
const ROOT_SKIP = new Set([
  "windows", "program files", "program files (x86)", "programdata", "$recycle.bin",
  "system volume information", "recovery", "$winreagent", "config.msi", "avast! sandbox", "msocache", "perflogs",
]);
const NEVER_ENTER = new Set([".git", ".hg", ".svn"]);

const REBUILDABLE_DIRS = new Map([
  ["__pycache__", ["python-cache", "Python bytecode cache, recreated automatically"]],
  [".pytest_cache", ["test-cache", "Test runner cache, recreated automatically"]],
  [".mypy_cache", ["type-check-cache", "Type checker cache, recreated automatically"]],
  [".ruff_cache", ["lint-cache", "Linter cache, recreated automatically"]],
  [".next", ["build-output", "Next.js build output, rebuilt on the next build"]],
  [".nuxt", ["build-output", "Nuxt build output, rebuilt on the next build"]],
  [".svelte-kit", ["build-output", "SvelteKit build output, rebuilt on the next build"]],
  [".turbo", ["build-cache", "Turborepo cache, rebuilt on the next build"]],
  [".parcel-cache", ["build-cache", "Parcel cache, rebuilt on the next build"]],
]);

const PACKAGE_CACHES = [
  ["\\appdata\\local\\pip\\cache", "pip download cache, re-downloads what it needs"],
  ["\\appdata\\local\\npm-cache", "npm download cache, re-downloads what it needs"],
  ["\\appdata\\local\\pnpm-cache", "pnpm metadata cache, re-downloads what it needs"],
  ["\\appdata\\local\\yarn\\cache", "Yarn cache, re-downloads what it needs"],
  ["\\appdata\\local\\nuitka\\nuitka\\cache", "Nuitka compiler cache, re-downloads what it needs"],
  ["\\appdata\\local\\nuget\\v3-cache", "NuGet cache, re-downloads what it needs"],
  ["\\appdata\\local\\go-build", "Go build cache, rebuilt when needed"],
  ["\\.gradle\\caches", "Gradle cache, re-downloads what it needs"],
];

const APP_CACHE_NAMES = new Set(["cache", "code cache", "gpucache", "shadercache", "dxcache", "glcache", "cacheddata"]);

const PARTIAL_EXT = new Set([".crdownload", ".part", ".partial", ".download", ".opdownload"]);
const TEMP_EXT = new Set([".tmp", ".temp"]);
const DUMP_EXT = new Set([".dmp", ".mdmp", ".hdmp"]);
const INSTALLER_EXT = new Set([".exe", ".msi", ".msix", ".msixbundle", ".appx", ".apk", ".xapk"]);
const DISK_IMAGE_EXT = new Set([".iso", ".img", ".vhd", ".vhdx", ".vmdk"]);
const ARCHIVE_EXT = new Set([".zip", ".rar", ".7z", ".tar", ".gz", ".tgz", ".xz", ".bz2"]);
// Duplicates are only hunted among standalone files. Copies inside app or game folders are often required.
const DUPE_EXT = new Set([
  ".zip", ".rar", ".7z", ".tar", ".gz", ".tgz", ".iso", ".exe", ".msi", ".msix", ".apk",
  ".mp4", ".mkv", ".mov", ".avi", ".webm", ".mp3", ".wav", ".flac", ".m4a",
  ".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".psd",
  ".pdf", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx", ".epub",
]);
const VERSION_DIR = /^(?:app-)?v?(\d+(?:\.\d+){1,3})$/i;

function archiveStem(name) {
  return name.replace(/\.(tar\.(gz|xz|bz2)|tgz|zip|rar|7z|tar|gz|xz|bz2)$/i, "");
}

function compareVersions(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

// Inside AppData, folders like CapCut\Apps\8.1.1 and 9.3.0: every version but the newest is a candidate.
function olderVersionDirs(entries, lowerDir) {
  if (!lowerDir.includes("\\appdata\\")) return new Map();
  const versions = entries
    .filter((e) => e.isDirectory() && VERSION_DIR.test(e.name))
    .map((e) => ({ name: e.name, v: e.name.match(VERSION_DIR)[1].split(".").map(Number) }));
  if (versions.length < 2) return new Map();
  versions.sort((a, b) => compareVersions(b.v, a.v));
  return new Map(versions.slice(1).map((x) => [x.name, versions[0].name]));
}

function dirRule(dirPath, nameL, lower, parent) {
  if (nameL === "node_modules") {
    if (fs.existsSync(path.join(parent, "package.json"))) {
      return { category: "node-modules", verdict: "remove", reason: "Project dependencies, reinstall anytime with npm install" };
    }
    return { skip: true }; // global tools such as AppData\Roaming\npm\node_modules
  }
  if (fs.existsSync(path.join(dirPath, "pyvenv.cfg"))) {
    return { category: "python-venv", verdict: "review", reason: "Python virtual environment, rebuild it with pip install" };
  }
  const rebuildable = REBUILDABLE_DIRS.get(nameL);
  if (rebuildable) return { category: rebuildable[0], verdict: "remove", reason: rebuildable[1] };
  for (const [suffix, reason] of PACKAGE_CACHES) {
    if (lower.endsWith(suffix)) return { category: "package-cache", verdict: "remove", reason };
  }
  if (lower.includes("\\appdata\\") && APP_CACHE_NAMES.has(nameL)) {
    return { category: "app-cache", verdict: "remove", reason: "App cache, rebuilt automatically", minBytes: 50 * MB };
  }
  return null;
}

function fileRule(name, ext, st, lower, siblingDirs, now) {
  const age = Math.floor((now - st.mtimeMs) / DAY);
  const nameL = name.toLowerCase();
  if (PARTIAL_EXT.has(ext) && age >= 2) {
    return { category: "partial-download", verdict: "remove", reason: `Unfinished download, untouched for ${age} days` };
  }
  if ((TEMP_EXT.has(ext) || name.startsWith("~$") || nameL === "thumbs.db" || nameL === ".ds_store") && age >= 1) {
    return { category: "temp-file", verdict: "remove", reason: "Temporary file left behind by an app" };
  }
  if (DUMP_EXT.has(ext) || /^hs_err_pid\d+\.log$/i.test(name)) {
    return { category: "crash-dump", verdict: "remove", reason: "Crash dump, only useful for debugging an old crash" };
  }
  const inDownloads = lower.includes("\\downloads\\");
  if (INSTALLER_EXT.has(ext) && inDownloads && age >= 14) {
    return { category: "installer", verdict: "review", reason: `Installer from ${age} days ago, you can download it again` };
  }
  if (DISK_IMAGE_EXT.has(ext) && inDownloads) {
    return { category: "disk-image", verdict: "review", reason: "Downloaded disk image" };
  }
  if (ARCHIVE_EXT.has(ext)) {
    const extracted = siblingDirs.get(archiveStem(name).toLowerCase());
    if (extracted) return { category: "extracted-archive", verdict: "review", reason: `Already extracted to the "${extracted}" folder next to it` };
  }
  if (ext === ".log" && age >= 30 && st.size >= MB) {
    return { category: "old-log", verdict: "review", reason: `Log file, last written ${age} days ago` };
  }
  if (lower.includes("\\appdata\\") && nameL.includes("cache") && st.size >= 100 * MB) {
    return { category: "cache-file", verdict: "review", reason: "Large cache file" };
  }
  return null;
}

function dupeEligible(lower, ext) {
  if (!DUPE_EXT.has(ext)) return false;
  if (lower.includes("\\appdata\\") && !lower.includes("\\appdata\\local\\temp\\")) return false;
  if (/\\\.[^\\]+\\/.test(lower)) return false; // inside a dot-folder
  if (INSTALLER_EXT.has(ext) && !lower.includes("\\downloads\\")) return false;
  return true;
}

function partialHash(file, size) {
  const fd = fs.openSync(file, "r");
  try {
    const n = Math.min(size, 65536);
    const head = Buffer.alloc(n);
    const tail = Buffer.alloc(n);
    fs.readSync(fd, head, 0, n, 0);
    fs.readSync(fd, tail, 0, n, Math.max(0, size - n));
    return crypto.createHash("sha1").update(head).update(tail).digest("hex");
  } finally {
    fs.closeSync(fd);
  }
}

function fullHash(file, onBytes) {
  const fd = fs.openSync(file, "r");
  const buf = Buffer.alloc(4 * MB);
  const hash = crypto.createHash("sha1");
  try {
    let pos = 0;
    let n;
    while ((n = fs.readSync(fd, buf, 0, buf.length, pos)) > 0) {
      hash.update(buf.subarray(0, n));
      pos += n;
      onBytes(n);
    }
    return hash.digest("hex");
  } finally {
    fs.closeSync(fd);
  }
}

function groupBy(list, key) {
  const groups = new Map();
  for (const item of list) {
    let k;
    try {
      k = key(item);
    } catch {
      continue;
    }
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(item);
  }
  return groups;
}

// The copy to keep: not in Downloads or Temp, not named "(1)", then the oldest, then the shortest path.
function pickKeeper(copies) {
  const penalty = ({ p }) => {
    const l = p.toLowerCase();
    return (l.includes("\\downloads\\") ? 4 : 0) + (l.includes("\\temp\\") ? 4 : 0) + (/\(\d+\)(\.[^.\\]+)?$/.test(l) ? 2 : 0);
  };
  return [...copies].sort((a, b) => penalty(a) - penalty(b) || a.mtime - b.mtime || a.p.length - b.p.length)[0];
}

export async function scan(roots, opts) {
  const items = new Map();
  const bySize = new Map();
  const stats = { files: 0, dirs: 0, bytes: 0, errors: 0 };
  const largeBytes = opts.largeFileMB * MB;
  const dupeMin = opts.dupeMinMB * MB;
  const exclude = opts.exclude ?? [];
  const now = Date.now();
  const report = opts.onProgress ?? (() => {});
  let current = "";
  let lastReport = 0;

  // Progress events: walk (while walking), walked (once), hash (while comparing duplicates).
  const throttled = (event) => {
    const t = Date.now();
    if (t - lastReport < 60) return;
    lastReport = t;
    report(event);
  };
  const progress = () => throttled({ type: "walk", files: stats.files, bytes: stats.bytes, current });
  const add = (item) => items.set(item.path.toLowerCase(), item);

  // Adds up a whole folder without classifying what is inside it.
  const treeSize = (dir) => {
    let size = 0, files = 0, newest = 0;
    const stack = [dir];
    while (stack.length) {
      const d = stack.pop();
      let entries;
      try {
        entries = fs.readdirSync(d, { withFileTypes: true });
      } catch {
        stats.errors++;
        continue;
      }
      for (const e of entries) {
        if (e.isSymbolicLink()) continue;
        const p = path.join(d, e.name);
        if (e.isDirectory()) stack.push(p);
        else if (e.isFile()) {
          try {
            const st = fs.statSync(p);
            size += st.size;
            files++;
            if (st.mtimeMs > newest) newest = st.mtimeMs;
          } catch {
            stats.errors++;
          }
        }
      }
      progress();
    }
    if (!newest) {
      try {
        newest = fs.statSync(dir).mtimeMs;
      } catch {
        newest = now;
      }
    }
    stats.files += files;
    stats.bytes += size;
    return { size, files, newest };
  };

  const addDir = (p, rule) => {
    const t = treeSize(p);
    if (t.size >= (rule.minBytes ?? 1)) {
      add({ kind: "dir", path: p, size: t.size, files: t.files, mtime: t.newest, category: rule.category, verdict: rule.verdict, reason: rule.reason });
    }
  };

  for (const root of roots) {
    const stack = [path.resolve(root)];
    while (stack.length) {
      const dir = stack.pop();
      current = dir;
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        stats.errors++;
        continue;
      }
      stats.dirs++;
      const lowerDir = dir.toLowerCase();
      const isDriveRoot = path.dirname(dir) === dir;

      // Temp folder: everything untouched for a week, listed as whole entries.
      if (lowerDir.endsWith("\\appdata\\local\\temp")) {
        for (const e of entries) {
          if (e.isSymbolicLink() || e.name.toLowerCase() === "claude") continue;
          const p = path.join(dir, e.name);
          let st;
          try {
            st = fs.statSync(p);
          } catch {
            continue;
          }
          if (now - st.mtimeMs < 7 * DAY) continue;
          const rule = { category: "temp", verdict: "remove", reason: "Temporary data an app left behind over a week ago", minBytes: MB };
          if (e.isDirectory()) addDir(p, rule);
          else if (st.size >= rule.minBytes) add({ kind: "file", path: p, size: st.size, mtime: st.mtimeMs, ...rule });
        }
        continue;
      }

      const siblingDirs = new Map(entries.filter((e) => e.isDirectory()).map((e) => [e.name.toLowerCase(), e.name]));
      const oldVersions = olderVersionDirs(entries, lowerDir);

      for (const e of entries) {
        if (e.isSymbolicLink()) continue;
        const p = path.join(dir, e.name);
        const lower = p.toLowerCase();

        if (e.isDirectory()) {
          const nameL = e.name.toLowerCase();
          if (NEVER_ENTER.has(nameL)) continue;
          if (isDriveRoot && ROOT_SKIP.has(nameL)) continue;
          if (exclude.some((x) => lower === x || lower.startsWith(x + "\\"))) continue;
          let rule = dirRule(p, nameL, lower, dir);
          if (!rule && oldVersions.has(e.name)) {
            rule = { category: "old-app-version", verdict: "review", reason: `Older app version, the newest one is ${oldVersions.get(e.name)}` };
          }
          if (rule?.skip) continue;
          if (rule) addDir(p, rule);
          else stack.push(p);
          continue;
        }

        if (!e.isFile()) continue;
        let st;
        try {
          st = fs.statSync(p);
        } catch {
          stats.errors++;
          continue;
        }
        stats.files++;
        stats.bytes += st.size;
        const ext = path.extname(e.name).toLowerCase();
        const rule = fileRule(e.name, ext, st, lower, siblingDirs, now);
        if (rule) add({ kind: "file", path: p, size: st.size, mtime: st.mtimeMs, ...rule });
        else if (st.size >= largeBytes) add({ kind: "file", path: p, size: st.size, mtime: st.mtimeMs, category: "large-file", verdict: "unknown", reason: "Large file" });
        if (st.size >= dupeMin && dupeEligible(lower, ext)) {
          if (!bySize.has(st.size)) bySize.set(st.size, []);
          bySize.get(st.size).push({ p, mtime: st.mtimeMs });
        }
        progress();
      }
    }
  }

  report({ type: "walked", files: stats.files, bytes: stats.bytes, dirs: stats.dirs, errors: stats.errors, ms: Date.now() - now });

  // Duplicates: same size, then same first and last 64 KB, then the same full SHA-1.
  const sameSize = [...bySize.entries()].filter(([, copies]) => copies.length > 1);
  const toHash = sameSize.reduce((sum, [size, copies]) => sum + size * copies.length, 0);
  let hashed = 0;
  for (const [size, copies] of sameSize) {
    for (const partial of groupBy(copies, (x) => partialHash(x.p, size)).values()) {
      if (partial.length < 2) continue;
      const full = size <= 131072 ? [partial] : [...groupBy(partial, (x) => fullHash(x.p, (n) => {
        hashed += n;
        throttled({ type: "hash", done: hashed, total: toHash });
      })).values()];
      for (const same of full) {
        if (same.length < 2) continue;
        const keeper = pickKeeper(same);
        // A copy in a Backup folder may be deliberate, so the owner decides.
        const backup = same.some((x) => /\\backups?\\/i.test(x.p));
        for (const copy of same) {
          if (copy === keeper) continue;
          add({
            kind: "file", path: copy.p, size, mtime: copy.mtime, category: "duplicate", verdict: backup ? "review" : "remove",
            reason: `Exact copy of ${path.basename(keeper.p)} in ${path.dirname(keeper.p)}${backup ? ", possibly a deliberate backup" : ""}`,
            duplicateOf: keeper.p,
          });
        }
      }
    }
  }

  return { items: [...items.values()], stats };
}
