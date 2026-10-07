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
  mode?: string;
  threats?: number;
  suspicious?: number;
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

export type Severity = "threat" | "suspicious" | "notice";

export interface KeyStatus {
  hasKey: boolean;
  source: "secure" | "cli" | null;
  hint: string | null;
}

export interface ThreatFinding {
  id: string;
  weight: number;
  label: string;
  detail: string | null;
  counted: boolean;
}

export interface Signer {
  status: "valid" | "invalid" | "untrusted" | "none" | "unknown";
  subject: string | null;
  os?: boolean;
}

export interface Reputation {
  source: "malwarebazaar" | "virustotal";
  found: boolean;
  label?: string | null;
  malicious?: number;
  suspicious?: number;
  total?: number;
}

export interface StartupRef {
  id: number;
  source: "registry" | "startup-folder" | "task" | "service" | "winlogon" | "debugger" | "wmi";
  location: string;
  name: string;
  command: string;
  target: string | null;
  missing: boolean;
  publisher: string | null;
  lolbin: string | null;
}

export interface StartupEntry extends StartupRef {
  signer: Signer | null;
  severity: Severity | "clean" | "missing";
  reasons: string[];
}

export interface ThreatResult {
  id: number;
  path: string;
  name: string;
  size: number;
  mtime: number;
  kind: string;
  sha256: string | null;
  severity: Severity;
  score: number;
  findings: ThreatFinding[];
  detections: { source: "hash" | "defender" | "malwarebazaar" | "virustotal"; name: string }[];
  signer: Signer | null;
  zone: { id: number; url: string | null } | null;
  autostart: StartupRef | null;
  ai: { verdict: "likely-benign" | "unclear" | "likely-malicious"; confidence: number; reason: string } | null;
  reputation: Reputation[];
  trusted: boolean;
  status: "found" | "quarantined" | "trusted" | "failed";
}

export interface ThreatScan {
  mode: "quick" | "full" | "custom";
  roots: string[];
  startedAt: number;
  durationMs: number;
  finishedAt: number;
  stats: { filesSeen: number; inspected: number; programs: number; signed: number; startups: number; threats: number; suspicious: number; notices: number };
  engines: {
    rules: boolean;
    hashList: boolean;
    defender: boolean | null;
    malwareBazaar: boolean;
    virusTotal: boolean;
    gemini: boolean;
    defenderReason: string | null;
    model: string | null;
    aiError: string | null;
  };
  results: ThreatResult[];
  startups: StartupEntry[];
  errors: string[];
}

export interface ProtectStatus {
  defender: { available: boolean; mode?: string; engine?: string; updated?: string | null; reason?: string | null };
  keys: { malwareBazaar: KeyStatus; virusTotal: KeyStatus };
  knownHashes: number;
  quarantined: number;
}

export interface Quarantined {
  id: string;
  original: string;
  size: number;
  sha256: string | null;
  reason: string | null;
  severity: Severity | null;
  time: string;
}

export type ThreatEvent =
  | { type: "phase"; phase: "autostart" | "walk" | "inspect" | "signatures" | "defender" | "reputation" | "ai" }
  | { type: "autostart"; count: number }
  | { type: "walk"; files: number; candidates: number; current: string }
  | { type: "walked"; files: number; candidates: number }
  | { type: "inspect"; done: number; total: number; current: string }
  | { type: "signatures"; checked: number }
  | { type: "defender" | "reputation" | "ai"; done: number; total: number };

export type ServiceName = "malwareBazaar" | "virusTotal";

export interface NetNode {
  id: number;
  parent: number;
  path: string;
  name: string;
  size: number;
  depth: number;
  sub: number;
  open: boolean;
  more?: number;
}

export interface FolderNetwork {
  root: string;
  nodes: NetNode[];
  total: { dirs: number; files: number; bytes: number; unreadable: number };
  shown: number;
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
  graphNetwork(request: { root: string; budget?: number }): Promise<{ ok: true; network: FolderNetwork } | { ok: false; cancelled?: boolean; error?: string }>;
  graphNetworkCancel(): Promise<boolean>;
  onNetworkEvent(fn: (ev: { type: "map"; files: number; bytes: number; current: string }) => void): () => void;
  protectStatus(): Promise<ProtectStatus>;
  lastThreatScan(): Promise<ThreatScan | null>;
  startThreatScan(request: { mode: ThreatScan["mode"]; roots?: string[] }): Promise<{ ok: true; scan: ThreatScan } | { ok: false; cancelled?: boolean; error?: string }>;
  cancelThreatScan(): Promise<boolean>;
  onThreatEvent(fn: (ev: ThreatEvent) => void): () => void;
  quarantineItems(ids: number[]): Promise<{ done: number; failed: { path: string; reason: string }[]; scan: ThreatScan }>;
  trustItem(id: number): Promise<ThreatScan>;
  lookupItem(id: number): Promise<{ opened: true } | { opened: false; result: Reputation; scan: ThreatScan }>;
  listQuarantine(): Promise<Quarantined[]>;
  restoreQuarantine(id: string): Promise<Quarantined[]>;
  deleteQuarantine(id: string): Promise<Quarantined[]>;
  setServiceKey(request: { name: ServiceName; key: string }): Promise<{ ok: true; status: ProtectStatus } | { ok: false; message: string }>;
  clearServiceKey(name: ServiceName): Promise<ProtectStatus>;
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
