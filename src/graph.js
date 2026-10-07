import fs from "node:fs";
import path from "node:path";
import { categoryOf } from "./organize.js";

// Reads folders one level at a time for the folder graph. Names, sizes and dates only, never contents.
const SKIP = /^(\$recycle\.bin|system volume information|\$windows\.~bt|\$winreagent|config\.msi|recovery|pagefile\.sys|hiberfil\.sys|swapfile\.sys|dumpstack\.log\.tmp)$/i;
const HEAVY = new Set(["node_modules", ".git", "__pycache__", ".venv", "venv", ".next", ".nuxt", "dist", "build", "target", ".cache", ".gradle", "bin", "obj"]);
const STAT_LIMIT = 4000;
// Dot-folders and the profile's own hidden bits (AppData, ntuser.*) are drawn only on request.
const HIDDEN = /^(\.|appdata$|ntuser|desktop\.ini$|thumbs\.db$)/i;

function countEntries(dir) {
  try {
    return { count: fs.readdirSync(dir).length };
  } catch {
    return { count: 0, locked: true };
  }
}

// One folder's children: subfolders first, then the biggest files, the rest folded into one "more" node.
export function readLevel(dir, { maxDirs = 40, maxFiles = 24, flags = null } = {}) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    return { children: [], error: err.code === "EPERM" || err.code === "EACCES" ? "needs admin rights" : err.code ?? "unreadable" };
  }
  const dirs = [];
  const files = [];
  for (const e of entries) {
    if (SKIP.test(e.name) || e.isSymbolicLink()) continue;
    const p = path.join(dir, e.name);
    const hidden = HIDDEN.test(e.name) || undefined;
    if (e.isDirectory()) dirs.push({ kind: "dir", path: p, name: e.name, hidden });
    else if (e.isFile()) files.push({ kind: "file", path: p, name: e.name, size: 0, hidden });
  }
  for (const f of files.slice(0, STAT_LIMIT)) {
    try {
      const st = fs.statSync(f.path);
      f.size = st.size;
      f.mtime = st.mtimeMs;
    } catch {
      // vanished or locked: keep it with size 0
    }
  }
  // Visible things first, so hidden ones never push real folders out of the picture.
  dirs.sort((a, b) => Number(Boolean(a.hidden)) - Number(Boolean(b.hidden)) || a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }));
  files.sort((a, b) => Number(Boolean(a.hidden)) - Number(Boolean(b.hidden)) || b.size - a.size);

  const shownDirs = dirs.slice(0, maxDirs);
  const shownFiles = files.slice(0, maxFiles);
  for (const d of shownDirs) {
    Object.assign(d, countEntries(d.path));
    if (HEAVY.has(d.name.toLowerCase())) d.heavy = true;
  }
  for (const f of shownFiles) {
    f.category = categoryOf(f.name) ?? "other";
  }
  const children = [...shownDirs, ...shownFiles];
  if (flags) for (const n of children) {
    const flag = flags.get(n.path.toLowerCase());
    if (flag) n.flag = flag;
  }
  const hiddenDirs = dirs.length - shownDirs.length;
  const hiddenFiles = files.length - shownFiles.length;
  if (hiddenDirs + hiddenFiles > 0) {
    children.push({
      kind: "more",
      path: `${dir}${path.sep}…`,
      name: `${hiddenDirs + hiddenFiles} more`,
      dirs: hiddenDirs,
      files: hiddenFiles,
      size: files.slice(maxFiles).reduce((s, f) => s + f.size, 0),
    });
  }
  return { children };
}

// The starting picture: the folder, its children, and a preview of each subfolder so the web has depth.
export function readGraph(root, { flags = null, preview = 8 } = {}) {
  root = path.resolve(root);
  const top = readLevel(root, { flags });
  for (const child of top.children) {
    if (child.kind !== "dir" || child.locked || child.heavy || child.hidden || !child.count) continue;
    const level = readLevel(child.path, { maxDirs: Math.ceil(preview / 2), maxFiles: Math.floor(preview / 2), flags });
    child.children = level.children;
    child.partial = true;
  }
  return {
    kind: "dir",
    path: root,
    name: path.basename(root) || root,
    count: top.children.length,
    children: top.children,
    error: top.error,
  };
}

// True when target sits inside root (or is root). Used to keep the window inside the folder it opened.
export function isInside(root, target) {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}
