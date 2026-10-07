import { useSyncExternalStore } from "react";
import { api } from "./api";
import { formatSize, setHome } from "./format";
import type {
  AppInfo, AuditEntry, Drive, GraphNode, Held, MapResult, OrganizePlace, OrganizePlan, OrganizeRun, ScanEvent, ScanResult, SettingsView,
} from "./types";

export type Page = "overview" | "scan" | "organize" | "map" | "graph" | "holding" | "activity" | "settings";

export interface Toast {
  id: number;
  tone: "ok" | "warn" | "error" | "info";
  title: string;
  body?: string;
}

export interface ScanProgress {
  phase: "walk" | "hash" | "inspect" | "ai" | "finish";
  files: number;
  bytes: number;
  dirs: number;
  current: string;
  hashDone: number;
  hashTotal: number;
  copies: number | null;
  inspected: number | null;
  aiDone: number;
  aiTotal: number;
  aiModel: string | null;
  startedAt: number;
}

export interface State {
  page: Page;
  scanView: "results" | "setup";
  // Opens one finding (and optionally its delete confirmation); used by links and screenshot mode.
  focus: { id: number; confirm?: boolean } | null;
  ready: boolean;
  info: AppInfo | null;
  settings: SettingsView | null;
  drives: Drive[];
  scan: ScanResult | null;
  scanRunning: boolean;
  progress: ScanProgress | null;
  map: MapResult | null;
  mapRunning: boolean;
  mapProgress: { files: number; bytes: number; current: string; startedAt: number } | null;
  mapAiPending: boolean;
  held: Held[];
  activity: AuditEntry[];
  toasts: Toast[];
  palette: boolean;
  org: {
    places: OrganizePlace[];
    root: string | null;
    plan: OrganizePlan | null;
    planning: boolean;
    applying: boolean;
    run: OrganizeRun | null; // the run just applied, shown with its undo button
    history: OrganizeRun[];
  };
  graph: { root: string | null; tree: GraphNode | null; loading: boolean; expanding: string | null };
}

let state: State = {
  page: "overview",
  scanView: "results",
  focus: null,
  ready: false,
  info: null,
  settings: null,
  drives: [],
  scan: null,
  scanRunning: false,
  progress: null,
  map: null,
  mapRunning: false,
  mapProgress: null,
  mapAiPending: false,
  held: [],
  activity: [],
  toasts: [],
  palette: false,
  org: { places: [], root: null, plan: null, planning: false, applying: false, run: null, history: [] },
  graph: { root: null, tree: null, loading: false, expanding: null },
};

const listeners = new Set<() => void>();
export const store = {
  get: () => state,
  set(patch: Partial<State> | ((s: State) => Partial<State>)) {
    state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
    listeners.forEach((l) => l());
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export function useStore<T>(select: (s: State) => T): T {
  return useSyncExternalStore(store.subscribe, () => select(state));
}

export const go = (page: Page) => store.set({ page, palette: false });

let toastId = 0;
export function toast(tone: Toast["tone"], title: string, body?: string) {
  const id = ++toastId;
  store.set((s) => ({ toasts: [...s.toasts, { id, tone, title, body }] }));
  setTimeout(() => store.set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), tone === "error" ? 9000 : 5500);
}
export const dismissToast = (id: number) => store.set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));

const message = (err: unknown) => (err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(err));

// ---- loading ----
export async function boot() {
  const [info, settings, drives, scan, map, held, activity] = await Promise.all([
    api.info(), api.getSettings(), api.drives(), api.lastScan(), api.lastMap(), api.listHeld(), api.listActivity(200),
  ]);
  setHome(info.home);
  store.set({ info, settings, drives, scan, map, held, activity, ready: true });
}

export const refreshDrives = async () => store.set({ drives: await api.drives() });
export const refreshHeld = async () => store.set({ held: await api.listHeld() });
export const refreshActivity = async () => store.set({ activity: await api.listActivity(500) });

// ---- scanning ----
const emptyProgress = (): ScanProgress => ({
  phase: "walk", files: 0, bytes: 0, dirs: 0, current: "", hashDone: 0, hashTotal: 0, copies: null, inspected: null, aiDone: 0, aiTotal: 0, aiModel: null, startedAt: Date.now(),
});

function applyEvent(p: ScanProgress, ev: ScanEvent): ScanProgress {
  switch (ev.type) {
    case "walk":
      return { ...p, phase: "walk", files: ev.files, bytes: ev.bytes, current: ev.current };
    case "walked":
      return { ...p, phase: "hash", files: ev.files, bytes: ev.bytes, dirs: ev.dirs, current: "" };
    case "hash":
      return { ...p, phase: "hash", hashDone: ev.done, hashTotal: ev.total };
    case "hashed":
      return { ...p, phase: "inspect", copies: ev.copies };
    case "inspect":
      return { ...p, phase: "inspect", current: ev.current };
    case "inspected":
      return { ...p, phase: "ai", inspected: ev.files, current: "" };
    case "ai":
      return { ...p, phase: "ai", aiDone: ev.done, aiTotal: ev.total };
    case "aiDone":
      return { ...p, phase: "finish", aiDone: ev.checked, aiTotal: ev.total, aiModel: ev.model };
  }
}

export async function startScan(roots: string[]) {
  if (store.get().scanRunning) return;
  store.set({ scanRunning: true, progress: emptyProgress(), page: "scan" });
  const off = api.onScanEvent((ev) => store.set((s) => ({ progress: s.progress ? applyEvent(s.progress, ev) : s.progress })));
  try {
    const r = await api.startScan({ roots });
    if (r.ok) {
      const safe = r.scan.entries.filter((e) => e.verdict === "remove");
      store.set({ scan: r.scan, scanView: "results" });
      toast("ok", "Scan complete", `${formatSize(safe.reduce((s, e) => s + e.size, 0))} is safe to remove.`);
    } else if (r.cancelled) {
      toast("info", "Scan cancelled", "Nothing was changed.");
    } else {
      toast("error", "The scan stopped", r.error);
    }
  } catch (err) {
    toast("error", "The scan stopped", message(err));
  } finally {
    off();
    store.set({ scanRunning: false, progress: null });
    refreshActivity();
  }
}
export const cancelScan = () => api.cancelScan();

export async function act(ids: number[], action: "hold" | "delete") {
  try {
    const r = await api.act({ ids, action });
    store.set((s) => ({ scan: s.scan ? { ...s.scan, entries: r.entries } : s.scan }));
    if (action === "hold") toast("ok", `${r.done} item${r.done === 1 ? "" : "s"} moved to the holding area`, "Restore them any time, or purge to free the space.");
    else toast("ok", `${r.done} item${r.done === 1 ? "" : "s"} deleted`, r.freed ? `${formatSize(r.freed)} freed on the drive.` : undefined);
    if (r.failed) toast("warn", `${r.failed} item${r.failed === 1 ? "" : "s"} could not be removed`, "They are in use or need admin rights.");
    if (r.blocked) toast("warn", `${r.blocked} item${r.blocked === 1 ? " was" : "s were"} protected`, "System folders and policy exclusions are never touched.");
    refreshDrives();
    refreshHeld();
    refreshActivity();
    return r;
  } catch (err) {
    toast("error", "Nothing was removed", message(err));
    return null;
  }
}

// ---- space map ----
export async function startMap(root: string) {
  if (store.get().mapRunning) return;
  store.set({ mapRunning: true, mapProgress: { files: 0, bytes: 0, current: "", startedAt: Date.now() }, page: "map" });
  const off = api.onMapEvent((ev) => store.set((s) => ({ mapProgress: s.mapProgress ? { ...s.mapProgress, ...ev } : s.mapProgress })));
  try {
    const r = await api.startMap({ root });
    if (r.ok) store.set({ map: r.map, mapAiPending: r.aiPending });
    else if (r.cancelled) toast("info", "Map cancelled");
    else toast("error", "The map stopped", r.error);
  } catch (err) {
    toast("error", "The map stopped", message(err));
  } finally {
    off();
    store.set({ mapRunning: false, mapProgress: null });
    refreshActivity();
  }
}

api.onMapExplained((map) => store.set({ map, mapAiPending: false }));

// ---- organizer ----
const setOrg = (patch: Partial<State["org"]>) => store.set((s) => ({ org: { ...s.org, ...patch } }));

export async function loadOrganize() {
  const [places, history] = await Promise.all([api.organizePlaces(), api.organizeHistory()]);
  setOrg({ places, history });
}

export async function planOrganize(root: string) {
  if (store.get().org.planning) return;
  setOrg({ root, planning: true, plan: null, run: null });
  try {
    const r = await api.planOrganize({ root });
    if (r.ok) {
      setOrg({ plan: r.plan });
      if (r.plan.aiError) toast("warn", "Gemini could not plan this time", `Using the local rules instead. ${r.plan.aiError}`);
    } else {
      setOrg({ root: null });
      toast("warn", "This folder can't be organized", r.error);
    }
  } catch (err) {
    toast("error", "Could not read the folder", message(err));
  } finally {
    setOrg({ planning: false });
  }
}

export async function applyOrganize(moves: { id: number; folder: string }[]) {
  setOrg({ applying: true });
  try {
    const r = await api.applyOrganize({ moves });
    const failed = r.run.failed.length;
    setOrg({ plan: null, run: r.run, history: await api.organizeHistory(), places: await api.organizePlaces() });
    toast(failed ? "warn" : "ok", `${r.run.moved} file${r.run.moved === 1 ? "" : "s"} organized`, failed ? `${failed} were in use and stayed put.` : "Undo puts everything back.");
  } catch (err) {
    toast("error", "Nothing was moved", message(err));
  } finally {
    setOrg({ applying: false });
    refreshActivity();
  }
}

export async function undoOrganize(id: string) {
  try {
    const r = await api.undoOrganize(id);
    setOrg({ run: store.get().org.run?.id === id ? null : store.get().org.run, history: await api.organizeHistory(), places: await api.organizePlaces() });
    toast(r.skipped ? "warn" : "ok", `${r.restored} file${r.restored === 1 ? "" : "s"} put back`, r.skipped ? `${r.skipped} had moved or changed since and were left alone.` : "Folders it created are gone too.");
  } catch (err) {
    toast("error", "Could not undo", message(err));
  } finally {
    refreshActivity();
  }
}
export const cancelOrganize = () => setOrg({ plan: null, root: null });

// ---- folder graph ----
const setGraph = (patch: Partial<State["graph"]>) => store.set((s) => ({ graph: { ...s.graph, ...patch } }));

export async function loadGraph(root: string) {
  setGraph({ root, loading: true });
  try {
    const r = await api.graphLoad({ root });
    setGraph({ tree: r.tree });
  } catch (err) {
    toast("error", "Could not open the folder", message(err));
  } finally {
    setGraph({ loading: false });
  }
}

function replaceChildren(node: GraphNode, path: string, children: GraphNode[]): GraphNode {
  if (node.path === path) return { ...node, children, partial: false, count: node.count ?? children.length };
  if (!node.children || !path.toLowerCase().startsWith(node.path.toLowerCase())) return node;
  return { ...node, children: node.children.map((c) => (c.kind === "dir" ? replaceChildren(c, path, children) : c)) };
}

export async function expandGraph(path: string) {
  const { tree, expanding } = store.get().graph;
  if (!tree || expanding) return;
  setGraph({ expanding: path });
  try {
    const r = await api.graphExpand(path);
    if (r.error) toast("warn", "That folder is locked", r.error);
    const current = store.get().graph.tree;
    if (current) setGraph({ tree: replaceChildren(current, path, r.children) });
  } catch (err) {
    toast("error", "Could not open the folder", message(err));
  } finally {
    setGraph({ expanding: null });
  }
}

export function collapseGraph(path: string) {
  const current = store.get().graph.tree;
  if (!current) return;
  const strip = (node: GraphNode): GraphNode =>
    node.path === path ? { ...node, children: undefined, partial: false } : node.children ? { ...node, children: node.children.map(strip) } : node;
  setGraph({ tree: strip(current) });
}

export async function saveSettings(patch: Parameters<typeof api.setSettings>[0]) {
  try {
    store.set({ settings: await api.setSettings(patch) });
  } catch (err) {
    toast("error", "Settings were not saved", message(err));
  }
}

export { message as errorMessage };
