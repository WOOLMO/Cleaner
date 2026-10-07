import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { walk, treeSize } from "./walk.js";

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
// Only folders with names like these are checked for a pyvenv.cfg, which keeps the walk fast.
const VENV_NAME = /venv|^env$|^\.env$|virtualenv/i;

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

// Markers that make a folder someone's project. Files inside are left alone by the duplicate and temp rules.
const PROJECT_FILES = new Set(["package.json", "pyproject.toml", "requirements.txt", "cargo.toml", "go.mod", "pom.xml", "build.gradle", "composer.json", "gemfile"]);
const PROJECT_EXT = /\.(sln|csproj|vcxproj)$/i;
// Folders where loose .exe files are downloads, not an installed app.
const USER_FOLDER = /^(downloads|desktop|bureau|documents|téléchargements|escritorio|descargas)$/i;
const DOWNLOAD_PLACE = /\\(downloads|desktop|bureau|téléchargements|descargas|escritorio)\\/i;

// Installed tools keep their own node_modules, caches and venvs under AppData or dot-folders like .vscode.
// Rebuildable-folder rules only apply outside those. AppData\Local\Temp is the exception: it is junk land.
export function isToolPath(lower) {
  if (lower.includes("\\appdata\\") && !lower.includes("\\appdata\\local\\temp\\")) return true;
  return /\\\.[^\\]+(\\|$)/.test(lower);
}

// A folder with project markers or program files: everything below it belongs to that project or app.
// Folders that hold your stuff in general (home, OneDrive, Desktop, Documents, Downloads) never count,
// so a stray cloudflared.exe or package.json in your home folder doesn't swallow everything under it.
export function containsProjectOrApp(dirName, listing) {
  if (USER_FOLDER.test(dirName) || /^onedrive( - .+)?$/i.test(dirName)) return false;
  if (listing.dirs.some((d) => d.name === ".git")) return true;
  for (const f of listing.files) {
    const n = f.name.toLowerCase();
    if (PROJECT_FILES.has(n) || PROJECT_EXT.test(n)) return true;
  }
  return listing.files.some((f) => /\.(exe|dll)$/i.test(f.name));
}

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

// Self-updating apps keep old copies: CapCut\Apps\8.1.1 next to 9.3.0, or Discord's app-1.0.9237 next to app-1.0.9238.
// Every version but the newest is a candidate. Game folders like .minecraft\versions are left alone.
export function olderVersionDirs(dirs, lowerDir) {
  if (!lowerDir.includes("\\appdata\\") || /\\\.[^\\]+(\\|$)/.test(lowerDir)) return new Map();
  const appsFolder = /\\apps$/.test(lowerDir);
  const versions = dirs
    .filter((d) => VERSION_DIR.test(d.name) && (appsFolder || /^app-/i.test(d.name)))
    .map((d) => ({ name: d.name, v: d.name.match(VERSION_DIR)[1].split(".").map(Number) }));
  if (versions.length < 2) return new Map();
  versions.sort((a, b) => compareVersions(b.v, a.v));
  return new Map(versions.slice(1).map((x) => [x.name, versions[0].name]));
}

export function dirRule(dirPath, nameL, lower, parentFiles, parentLower) {
  const tool = isToolPath(parentLower + "\\");
  if (nameL === "node_modules") {
    if (!tool && parentFiles.has("package.json")) {
      return { category: "node-modules", verdict: "remove", reason: "Project dependencies, reinstall anytime with npm install" };
    }
    return { skip: true }; // an installed tool's own modules: VS Code extensions, global npm, Electron apps
  }
  if (VENV_NAME.test(nameL) && fs.existsSync(path.join(dirPath, "pyvenv.cfg"))) {
    if (tool) return { skip: true };
    return { category: "python-venv", verdict: "review", reason: "Python virtual environment, rebuild it with pip install" };
  }
  const rebuildable = REBUILDABLE_DIRS.get(nameL);
  if (rebuildable) return tool ? { skip: true } : { category: rebuildable[0], verdict: "remove", reason: rebuildable[1] };
  for (const [suffix, reason] of PACKAGE_CACHES) {
    if (lower.endsWith(suffix)) return { category: "package-cache", verdict: "remove", reason };
  }
  if (lower.includes("\\appdata\\") && APP_CACHE_NAMES.has(nameL)) {
    return { category: "app-cache", verdict: "remove", reason: "App cache, rebuilt automatically", minBytes: 50 * MB };
  }
  return null;
}

export function fileRule(f, lower, siblingDirs, now, { contained = false } = {}) {
  const { name, size } = f;
  const ext = path.extname(name).toLowerCase();
  const age = Math.floor((now - f.mtimeMs) / DAY);
  const nameL = name.toLowerCase();
  const tool = isToolPath(lower);
  // Browser downloads (.crdownload) anywhere in your folders; generic .part files only where downloads land.
  const browserPartial = ext === ".crdownload" || ext === ".opdownload";
  if (PARTIAL_EXT.has(ext) && age >= 2 && !tool && !contained && (browserPartial || DOWNLOAD_PLACE.test(lower))) {
    return { category: "partial-download", verdict: "remove", reason: `Unfinished download, untouched for ${age} days` };
  }
  const officeLock = name.startsWith("~$") && size < 1024;
  const thumbs = nameL === "thumbs.db" || nameL === ".ds_store";
  if (age >= 1 && !tool && (thumbs || officeLock || (TEMP_EXT.has(ext) && !contained))) {
    return { category: "temp-file", verdict: "remove", reason: officeLock ? "Lock file an Office app left behind" : "Temporary file left behind by an app" };
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
  if (ext === ".log" && age >= 30 && size >= MB) {
    return { category: "old-log", verdict: "review", reason: `Log file, last written ${age} days ago` };
  }
  if (lower.includes("\\appdata\\") && nameL.includes("cache") && size >= 100 * MB) {
    return { category: "cache-file", verdict: "review", reason: "Large cache file" };
  }
  return null;
}

export function dupeEligible(lower, ext) {
  if (!DUPE_EXT.has(ext)) return false;
  if (lower.includes("\\appdata\\") && !lower.includes("\\appdata\\local\\temp\\")) return false;
  if (/\\\.[^\\]+\\/.test(lower)) return false; // inside a dot-folder
  if (INSTALLER_EXT.has(ext) && !lower.includes("\\downloads\\")) return false;
  return true;
}

async function partialHash(file, size) {
  const fh = await fsp.open(file, "r");
  try {
    const n = Math.min(size, 65536);
    const head = Buffer.alloc(n);
    const tail = Buffer.alloc(n);
    await fh.read(head, 0, n, 0);
    await fh.read(tail, 0, n, Math.max(0, size - n));
    return crypto.createHash("sha1").update(head).update(tail).digest("hex");
  } finally {
    await fh.close();
  }
}

async function fullHash(file, onBytes, signal) {
  const fh = await fsp.open(file, "r");
  const buf = Buffer.alloc(4 * MB);
  const hash = crypto.createHash("sha1");
  try {
    let pos = 0;
    for (;;) {
      signal?.throwIfAborted();
      const { bytesRead } = await fh.read(buf, 0, buf.length, pos);
      if (!bytesRead) break;
      hash.update(buf.subarray(0, bytesRead));
      pos += bytesRead;
      onBytes(bytesRead);
    }
    return hash.digest("hex");
  } finally {
    await fh.close();
  }
}

async function groupBy(list, key, signal) {
  const groups = new Map();
  for (const item of list) {
    let k;
    try {
      k = await key(item);
    } catch (err) {
      if (signal?.aborted) throw err;
      continue;
    }
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(item);
  }
  return groups;
}

// The copy to keep: not in Downloads or Temp, not named "(1)", then the oldest, then the shortest path.
export function pickKeeper(copies) {
  const penalty = ({ p }) => {
    const l = p.toLowerCase();
    return (l.includes("\\downloads\\") ? 4 : 0) + (l.includes("\\temp\\") ? 4 : 0) + (/\(\d+\)(\.[^.\\]+)?$/.test(l) ? 2 : 0);
  };
  return [...copies].sort((a, b) => penalty(a) - penalty(b) || a.mtime - b.mtime || a.p.length - b.p.length)[0];
}

export async function scan(roots, opts = {}) {
  const items = new Map();
  const bySize = new Map();
  const stats = { files: 0, dirs: 0, bytes: 0, errors: 0 };
  const largeBytes = (opts.largeFileMB ?? 200) * MB;
  const dupeMin = (opts.dupeMinMB ?? 1) * MB;
  const exclude = opts.exclude ?? [];
  const excludeTest = opts.excludeTest ?? (() => false);
  const signal = opts.signal;
  const report = opts.onProgress ?? (() => {});
  const now = Date.now();
  // The folders you asked to scan and your home folder are never treated as one big project or app.
  const neverContained = new Set([...roots.map((r) => path.resolve(r).toLowerCase()), os.homedir().toLowerCase()]);
  let current = "";
  let lastReport = 0;

  // Progress events: walk (while walking), walked (once), hash (while comparing duplicates).
  const throttled = (event) => {
    const t = Date.now();
    if (t - lastReport < 60) return;
    lastReport = t;
    report(event);
  };
  const add = (item) => items.set(item.path.toLowerCase(), item);

  const addTree = async (p, rule) => {
    const t = await treeSize(p, { signal });
    stats.files += t.files;
    stats.bytes += t.size;
    stats.errors += t.unreadable;
    if (t.size >= (rule.minBytes ?? 1)) {
      add({ kind: "dir", path: p, size: t.size, files: t.files, mtime: t.newest || now, category: rule.category, verdict: rule.verdict, reason: rule.reason });
    }
  };

  await walk(roots.map((r) => ({ dir: path.resolve(r), contained: false })), async ({ dir, contained: insideProject }, listing) => {
    if (!listing) {
      stats.errors++;
      return null;
    }
    stats.dirs++;
    current = dir;
    const lowerDir = dir.toLowerCase();

    // Temp folder: everything untouched for a week, listed as whole entries.
    if (lowerDir.endsWith("\\appdata\\local\\temp")) {
      const rule = { category: "temp", verdict: "remove", reason: "Temporary data an app left behind over a week ago", minBytes: MB };
      for (const f of listing.files) {
        stats.files++;
        stats.bytes += f.size;
        if (now - f.mtimeMs >= 7 * DAY && f.size >= rule.minBytes) add({ kind: "file", path: f.path, size: f.size, mtime: f.mtimeMs, ...rule });
      }
      await Promise.all(listing.dirs.map(async (d) => {
        const st = await fsp.stat(d.path).catch(() => null);
        if (st && now - st.mtimeMs >= 7 * DAY) await addTree(d.path, rule);
      }));
      return null;
    }

    const isDriveRoot = path.dirname(dir) === dir;
    const contained = insideProject || (!neverContained.has(lowerDir) && containsProjectOrApp(path.basename(dir), listing));
    const siblingDirs = new Map(listing.dirs.map((d) => [d.name.toLowerCase(), d.name]));
    const fileNames = new Set(listing.files.map((f) => f.name.toLowerCase()));
    const oldVersions = olderVersionDirs(listing.dirs, lowerDir);
    const next = [];
    const trees = [];

    for (const d of listing.dirs) {
      const nameL = d.name.toLowerCase();
      const lower = d.path.toLowerCase();
      if (NEVER_ENTER.has(nameL)) continue;
      if (isDriveRoot && ROOT_SKIP.has(nameL)) continue;
      if (exclude.some((x) => lower === x || lower.startsWith(x + "\\")) || excludeTest(d.path)) continue;
      let rule = dirRule(d.path, nameL, lower, fileNames, lowerDir);
      if (!rule && oldVersions.has(d.name)) {
        rule = { category: "old-app-version", verdict: "review", reason: `Older app version, the newest one is ${oldVersions.get(d.name)}` };
      }
      if (rule?.skip) continue;
      if (rule) trees.push(addTree(d.path, rule));
      else next.push({ dir: d.path, contained });
    }

    for (const f of listing.files) {
      stats.files++;
      stats.bytes += f.size;
      const lower = f.path.toLowerCase();
      const rule = fileRule(f, lower, siblingDirs, now, { contained });
      if (rule) add({ kind: "file", path: f.path, size: f.size, mtime: f.mtimeMs, ...rule });
      else if (f.size >= largeBytes) add({ kind: "file", path: f.path, size: f.size, mtime: f.mtimeMs, category: "large-file", verdict: "unknown", reason: "Large file" });
      const ext = path.extname(f.name).toLowerCase();
      if (f.size >= dupeMin && dupeEligible(lower, ext)) {
        if (!bySize.has(f.size)) bySize.set(f.size, []);
        bySize.get(f.size).push({ p: f.path, mtime: f.mtimeMs, contained });
      }
    }

    await Promise.all(trees);
    throttled({ type: "walk", files: stats.files, bytes: stats.bytes, current });
    return next;
  }, { signal });

  report({ type: "walked", files: stats.files, bytes: stats.bytes, dirs: stats.dirs, errors: stats.errors, ms: Date.now() - now });

  // Duplicates: same size, then same first and last 64 KB, then the same full SHA-1.
  // Copies inside a project or app can be the one that stays, but are never flagged themselves.
  const sameSize = [...bySize.entries()].filter(([, copies]) => copies.length > 1 && copies.some((x) => !x.contained));
  const toHash = sameSize.reduce((sum, [size, copies]) => sum + size * copies.length, 0);
  let hashed = 0;
  for (const [size, copies] of sameSize) {
    signal?.throwIfAborted();
    for (const partial of (await groupBy(copies, (x) => partialHash(x.p, size), signal)).values()) {
      if (partial.length < 2) continue;
      const full = size <= 131072 ? [partial] : [...(await groupBy(partial, (x) => fullHash(x.p, (n) => {
        hashed += n;
        throttled({ type: "hash", done: hashed, total: toHash });
      }, signal), signal)).values()];
      for (const same of full) {
        if (same.length < 2 || same.every((x) => x.contained)) continue;
        const inside = same.filter((x) => x.contained);
        const keeper = pickKeeper(inside.length ? inside : same);
        // A copy in a Backup folder may be deliberate, so the owner decides.
        const backup = same.some((x) => /\\backups?\\/i.test(x.p));
        for (const copy of same) {
          if (copy === keeper || copy.contained) continue;
          add({
            kind: "file", path: copy.p, size, mtime: copy.mtime, category: "duplicate", verdict: backup ? "review" : "remove",
            reason: `Exact copy of ${path.basename(keeper.p)} in ${path.dirname(keeper.p)}${backup ? ", possibly a deliberate backup" : ""}`,
            duplicateOf: keeper.p,
          });
        }
      }
    }
  }

  report({ type: "hashed", copies: [...items.values()].filter((i) => i.category === "duplicate").length, bytes: hashed });
  return { items: [...items.values()], stats };
}
