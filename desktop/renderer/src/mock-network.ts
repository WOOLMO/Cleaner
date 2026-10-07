// A made-up folder network for demo mode: generated from a fixed seed so screenshots stay the same.
import type { CleanerApi, FolderNetwork, NetNode } from "./types";

const HOME = "C:\\Users\\alex";
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const POOL = [
  "src", "assets", "cache", "data", "build", "lib", "bin", "docs", "images", "logs", "config", "plugins", "modules", "backup", "2024", "2025",
  "2026", "projects", "exports", "renders", "saves", "mods", "shaders", "models", "textures", "audio", "fonts", "locales", "packages", "versions",
  "profiles", "extensions", "storage", "sessions", "drafts", "archive", "raw", "edits", "clips", "scenes", "public", "components", "tests", "notebooks",
];
const TOP_HOME = ["AppData", "Desktop", "Documents", "Downloads", "Pictures", "Videos", "Music", "code", "OneDrive", "Games", "Saved Games", ".vscode", "3D Objects"];
const TOP_DRIVE = ["Windows", "Program Files", "Program Files (x86)", "ProgramData", "Users", "Games", "Riot Games", "XboxGames", "Intel", "PerfLogs"];

function generate(root: string): FolderNetwork {
  const random = rng(root.length * 7919 + 17);
  const top = /^[a-z]:\\$/i.test(root) ? TOP_DRIVE : TOP_HOME;
  const nodes: NetNode[] = [{ id: 0, parent: -1, path: root, name: root.split("\\").filter(Boolean).pop() ?? root, size: 0, depth: 0, sub: top.length, open: true }];
  const own: number[] = [0];
  // big branches stay big all the way down, like a real drive
  const BIG: Record<string, number> = { Windows: 30, "Program Files": 22, Users: 26, Games: 18, AppData: 24, Downloads: 12, Videos: 14, XboxGames: 10 };
  const weight: number[] = [1];
  const maxKids = [0, 16, 11, 7, 5, 4, 3];
  for (let i = 0; i < nodes.length && nodes.length < 3200; i++) {
    const n = nodes[i];
    if (n.depth >= 6) continue;
    const count = n.depth === 0 ? top.length : Math.floor(Math.pow(random(), 1.7) * maxKids[n.depth + 1] * (n.depth === 1 ? 1.4 : 1));
    const used = new Set<string>();
    for (let k = 0; k < count && nodes.length < 3200; k++) {
      let name = n.depth === 0 ? top[k] : POOL[Math.floor(random() * POOL.length)];
      while (used.has(name)) name = `${name}-${Math.floor(random() * 90 + 10)}`;
      used.add(name);
      nodes.push({ id: nodes.length, parent: n.id, path: `${n.path.replace(/\\$/, "")}\\${name}`, name, size: 0, depth: n.depth + 1, sub: 0, open: false });
      const w = n.depth === 0 ? BIG[name] ?? 1 : weight[n.id];
      weight.push(w);
      own.push(Math.exp(random() * 13) * 2000 * w);
    }
  }
  for (const n of nodes) if (n.parent >= 0) nodes[n.parent].sub++;
  for (const n of nodes) n.open = n.sub > 0;
  for (let i = nodes.length - 1; i >= 0; i--) {
    nodes[i].size += own[i];
    if (nodes[i].parent >= 0) nodes[nodes[i].parent].size += nodes[i].size;
  }
  const drive = /^[a-z]:\\$/i.test(root);
  return { root, nodes, total: { dirs: drive ? 418_303 : 61_528, files: drive ? 2_523_156 : 1_231_967, bytes: nodes[0].size, unreadable: drive ? 103 : 3 }, shown: nodes.length };
}

const listeners = new Set<(ev: { type: "map"; files: number; bytes: number; current: string }) => void>();
let cancelled = false;

export const networkMock: Pick<CleanerApi, "graphNetwork" | "graphNetworkCancel" | "onNetworkEvent"> = {
  async graphNetwork({ root }) {
    cancelled = false;
    const net = generate(root || HOME);
    for (let i = 1; i <= 14; i++) {
      if (cancelled) return { ok: false, cancelled: true };
      await wait(70);
      listeners.forEach((fn) => fn({ type: "map", files: Math.round((net.total.files * i) / 14), bytes: (net.total.bytes * i) / 14, current: net.nodes[(i * 211) % net.nodes.length].path }));
    }
    return { ok: true, network: net };
  },
  async graphNetworkCancel() {
    cancelled = true;
    return true;
  },
  onNetworkEvent(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
