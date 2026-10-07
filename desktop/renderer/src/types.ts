export type Verdict = "remove" | "review";
export type Status = "pending" | "removed" | "held" | "failed" | "missing" | "keep";

export interface Entry {
  id: number;
  verdict: Verdict;
  confidence: number;
  category: string;
  reason: string;
  size: number;
  path: string;
  status: Status;
  kind?: "file" | "dir";
  mtime?: number;
  files?: number;
  duplicateOf?: string;
  fileType?: string | null;
  sensitive?: boolean;
}

export interface ScanStats {
  files: number;
  dirs: number;
  bytes: number;
  errors: number;
}

export interface ScanResult {
  roots: string[];
  entries: Entry[];
  stats: ScanStats;
  candidates: number;
  checked: number;
  aiTotal: number;
  aiError: string | null;
  model: string;
  classifiedBy: string;
  leftOut: number;
  startedAt: number;
  durationMs: number;
  finishedAt: number;
}

export type ScanEvent =
  | { type: "walk"; files: number; bytes: number; current: string }
  | { type: "walked"; files: number; bytes: number; dirs: number; errors: number; ms: number }
  | { type: "hash"; done: number; total: number }
  | { type: "hashed"; copies: number; bytes: number }
  | { type: "inspect"; done: number; total: number; current: string }
  | { type: "inspected"; files: number; previews: number; sensitive: number }
  | { type: "ai"; done: number; total: number }
  | { type: "aiDone"; checked: number; total: number; model: string; error: string | null };

export interface Drive {
  root: string;
  letter: string;
  total: number;
  free: number;
}

export interface MapUnit {
  path: string;
  size: number;
  loose?: boolean;
  children: { name: string; size: number }[];
}

export type Advice = "keep" | "check" | "reclaim";

export interface Explanation {
  label: string;
  kind: string;
  advice: Advice;
  tip: string;
}

export interface MapResult {
  root: string;
  stats: ScanStats;
  units: MapUnit[];
  disk: { total: number; free: number } | null;
  explained: Record<string, Explanation>;
  explainError?: string | null;
  explainedBy?: string | null;
  finishedAt: number;
  durationMs: number;
}

export interface MapChildren {
  path: string;
  size: number;
  loose: number;
  children: { path: string; name: string; size: number }[];
}

export interface Held {
  batch: string;
  size: number;
  original: string;
  held: string;
}

export interface AuditEntry {
  time: string;
  action: string;
  app: string;
  user: string;
  machine: string;
  count?: number;
  bytes?: number;
  roots?: string[];
  root?: string;
  file?: string;
  kind?: string;
  changed?: string[];
  found?: number;
  files?: number;
  classifiedBy?: string;
  items?: { path: string; size: number; result?: string; to?: string }[];
  run?: string;
}

export interface Policy {
  managed: boolean;
  organization: string | null;
  aiEnabled?: boolean;
  allowPreviews?: boolean;
  allowPermanentDelete?: boolean;
  maxAiItems?: number;
  excludePaths: string[];
  error: string | null;
  source: string;
}

export type Theme = "system" | "dark" | "light";

export interface Settings {
  theme: Theme;
  aiEnabled: boolean;
  previews: boolean;
  maxAi: number;
  largeMB: number;
  exclude: string[];
  targets: string[];
}

export interface SettingsView {
  settings: Settings;
  locks: Partial<Record<keyof Settings, boolean>>;
  policy: Policy;
  allowPermanentDelete: boolean;
  key: { hasKey: boolean; source: "secure" | "cli" | null; hint: string | null };
}

export interface AppInfo {
  version: string;
  engineVersion: string;
  electron: string;
  dataDir: string;
  auditFile: string;
  policyFile: string;
  logFile: string;
  user: string;
  machine: string;
  home: string;
}

export interface ActResult {
  ok: boolean;
  done: number;
  failed: number;
  blocked: number;
  freed: number;
  entries: Entry[];
}

export type StartScanResult = { ok: true; scan: ScanResult } | { ok: false; cancelled?: boolean; error?: string };
export type StartMapResult = { ok: true; map: MapResult; aiPending: boolean } | { ok: false; cancelled?: boolean; error?: string };

export type Casing = "title" | "lower" | "upper" | "kebab" | "snake" | "pascal" | "sentence" | "natural";

export interface OrganizeStyle {
  language: string;
  languageName: string;
  languageSource: "folders" | "system" | "default";
  casing: Casing;
  numbering: { width: number; separator: string; next: number } | null;
  detected: boolean;
  sampleNames: string[];
}

export interface OrganizeFile {
  id: number;
  name: string;
  size: number;
  mtime: number;
  ext: string;
  category: string | null;
}

export interface OrganizeMove {
  id: number;
  folder: string;
  isNew: boolean;
  category: string | null;
  source: "rules" | "gemini";
  reason: string;
}

export interface OrganizePlan {
  root: string;
  style: OrganizeStyle;
  folders: { name: string; dominant: string | null; files: number; project: boolean }[];
  files: OrganizeFile[];
  skipped: { name: string; size: number; reason: string }[];
  moves: OrganizeMove[];
  stay: { id: number; reason: string }[];
  planner: string;
  aiError: string | null;
}

export interface OrganizeRun {
  id: string;
  root: string;
  time: string;
  moved: number;
  bytes: number;
  createdFolders: number;
  folders: string[];
  failed: { path: string; reason: string }[];
  undoneAt: string | null;
  restored: number | null;
}

export interface OrganizePlace {
  id: string;
  path: string;
  name: string;
  loose: number;
}

export interface GraphNode {
  kind: "dir" | "file" | "more";
  path: string;
  name: string;
  size?: number;
  mtime?: number;
  count?: number;
  category?: string;
  hidden?: boolean;
  heavy?: boolean;
  locked?: boolean;
  flag?: Verdict;
  dirs?: number;
  files?: number;
  partial?: boolean;
  error?: string;
  children?: GraphNode[];
}

export interface CleanerApi {
  info(): Promise<AppInfo>;
  drives(): Promise<Drive[]>;
  pickFolders(): Promise<string[]>;
  reveal(path: string): Promise<boolean>;
  openExternal(url: string): Promise<boolean>;
  openPath(which: "data" | "logs"): Promise<boolean>;
  getSettings(): Promise<SettingsView>;
  setSettings(patch: Partial<Settings>): Promise<SettingsView>;
  setKey(key: string): Promise<({ ok: true } & SettingsView) | { ok: false; message: string }>;
  clearKey(): Promise<SettingsView>;
  lastScan(): Promise<ScanResult | null>;
  startScan(request: { roots: string[]; ai?: boolean }): Promise<StartScanResult>;
  cancelScan(): Promise<boolean>;
  onScanEvent(fn: (ev: ScanEvent) => void): () => void;
  act(request: { ids: number[]; action: "hold" | "delete" }): Promise<ActResult>;
  onActProgress(fn: (p: { done: number; total: number }) => void): () => void;
  exportScript(): Promise<{ ps1: string; bat: string; safe: number; yours: number }>;
  exportReport(format: "csv" | "json" | "html"): Promise<{ ok: boolean; file?: string }>;
  lastMap(): Promise<MapResult | null>;
  startMap(request: { root: string }): Promise<StartMapResult>;
  cancelMap(): Promise<boolean>;
  onMapEvent(fn: (ev: { type: "map"; files: number; bytes: number; current: string }) => void): () => void;
  onMapExplained(fn: (map: MapResult) => void): () => void;
  mapChildren(path: string): Promise<MapChildren | null>;
  listHeld(): Promise<Held[]>;
  restoreHeld(paths: string[]): Promise<{ restored: number; conflicts: number; failed: number }>;
  purgeHeld(paths: string[]): Promise<{ purged: number; failed: number; freed: number }>;
  listActivity(limit?: number): Promise<AuditEntry[]>;
  exportActivity(): Promise<{ ok: boolean; file?: string }>;
  organizePlaces(): Promise<OrganizePlace[]>;
  pickFolder(title?: string): Promise<string | null>;
  planOrganize(request: { root: string; ai?: boolean }): Promise<{ ok: true; plan: OrganizePlan } | { ok: false; error: string }>;
  applyOrganize(request: { moves: { id: number; folder: string }[] }): Promise<{ ok: true; run: OrganizeRun }>;
  organizeHistory(): Promise<OrganizeRun[]>;
  undoOrganize(id: string): Promise<{ restored: number; skipped: number; run: OrganizeRun }>;
  graphLoad(request: { root: string }): Promise<{ ok: true; tree: GraphNode }>;
  graphExpand(path: string): Promise<{ children: GraphNode[]; error?: string }>;
}

export interface WindowApi {
  demo: boolean;
  capture?: boolean;
  setTitleBar(colors: { color: string; symbolColor: string }): void;
  onNavigate(fn: (page: string) => void): () => void;
}

declare global {
  interface Window {
    cleaner?: CleanerApi;
    cleanerWindow?: WindowApi;
  }
}
