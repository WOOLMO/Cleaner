import path from "node:path";
import { walk } from "./walk.js";

const MB = 1024 * 1024;

// Skipped when mapping a whole drive: Avast's sandbox mirrors real files (it would count them twice),
// and System Volume Information can't be read without admin rights.
const MAP_SKIP = new Set(["avast! sandbox", "system volume information"]);

// Folders that only group other things. The map looks inside them instead of reporting them as one block.
const CONTAINERS = [
  /^[a-z]:\\$/i,
  /^[a-z]:\\(program files|program files \(x86\)|programdata|users)$/i,
  /^[a-z]:\\users\\[^\\]+$/i,
  /\\appdata$/i,
  /\\appdata\\(local|locallow|roaming)$/i,
  /\\appdata\\local\\(packages|programs)$/i,
  /\\onedrive( - [^\\]+)?$/i,
  /\\(desktop|bureau|documents|documenten|dokumente|documentos|escritorio|downloads|téléchargements)$/i,
  /\\steamapps\\common$/i,
];

// Sizes every folder under root. Totals are kept for folders up to maxDepth deep; deeper folders count toward them.
export async function spaceMap(root, { maxDepth = 7, onProgress, signal } = {}) {
  root = path.resolve(root);
  const sizes = new Map([[root, 0]]);
  const kids = new Map();
  const stats = { files: 0, dirs: 0, bytes: 0, errors: 0 };
  let last = 0;

  await walk([{ dir: root, depth: 0, chain: [root] }], ({ dir, depth, chain }, listing) => {
    if (!listing) {
      stats.errors++;
      return null;
    }
    stats.dirs++;
    const own = listing.bytes;
    stats.files += listing.count;
    stats.bytes += own;
    for (const key of chain) sizes.set(key, sizes.get(key) + own);

    const isDriveRoot = path.dirname(dir) === dir;
    const next = [];
    for (const d of listing.dirs) {
      if (isDriveRoot && MAP_SKIP.has(d.name.toLowerCase())) continue;
      let childChain = chain;
      if (depth + 1 <= maxDepth) {
        childChain = [...chain, d.path];
        sizes.set(d.path, 0);
        if (!kids.has(dir)) kids.set(dir, []);
        kids.get(dir).push(d.path);
      }
      next.push({ dir: d.path, depth: depth + 1, chain: childChain });
    }
    const t = Date.now();
    if (onProgress && t - last > 60) {
      last = t;
      onProgress({ files: stats.files, bytes: stats.bytes, current: dir });
    }
    return next;
  }, { light: true, signal });

  return { root, sizes, kids, stats };
}

// Picks the folders worth explaining: it looks inside containers, steps through single-child wrappers
// (Epic Games\UE_5.5), and reports files sitting loose in a container as their own entry.
export function pickUnits({ root, sizes, kids }, { minBytes = 512 * MB, limit = 15 } = {}) {
  const units = [];
  const sizeOf = (p) => sizes.get(p) ?? 0;
  const childrenOf = (p) => (kids.get(p) ?? []).slice().sort((a, b) => sizeOf(b) - sizeOf(a));
  const isContainer = (p) => p === root || CONTAINERS.some((re) => re.test(p));

  const visit = (dir, stepped = false) => {
    const size = sizeOf(dir);
    if (size < minBytes && !stepped) return;
    const children = childrenOf(dir);
    if (isContainer(dir) && children.length) {
      let inChildren = 0;
      for (const child of children) {
        inChildren += sizeOf(child);
        visit(child);
      }
      if (size - inChildren >= minBytes) units.push({ path: dir, size: size - inChildren, loose: true });
      return;
    }
    if (!stepped && children.length && sizeOf(children[0]) >= 0.9 * size) {
      visit(children[0], true);
      return;
    }
    units.push({ path: dir, size });
  };
  visit(root);

  return units
    .sort((a, b) => b.size - a.size)
    .slice(0, limit)
    .map((u) => ({
      ...u,
      children: u.loose ? [] : childrenOf(u.path).slice(0, 4).map((p) => ({ name: path.basename(p), size: sizeOf(p) })),
    }));
}
