// Sample data for demo mode and the browser preview. Everything here is made up; nothing touches a disk.
import type {
  AppInfo, AuditEntry, CleanerApi, Drive, Entry, Explanation, Held, MapChildren, MapResult, ScanEvent, ScanResult, SettingsView,
} from "./types";
import { extraMock } from "./mock-extra";
import { protectMock } from "./mock-protect";
import { networkMock } from "./mock-network";

const GB = 1024 ** 3;
const MB = 1024 ** 2;
const DAY = 86_400_000;
const HOME = "C:\\Users\\alex";
const now = Date.now();
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Seed = Omit<Entry, "id" | "status">;
const seed: Seed[] = [
  { verdict: "remove", confidence: 0.99, category: "duplicate", reason: "Exact copy of a game archive kept in Archives", size: 6.21 * GB, path: `${HOME}\\Desktop\\Games\\closing-shift-v1.4.rar`, duplicateOf: `${HOME}\\Archives\\closing-shift-v1.4.rar`, kind: "file", mtime: now - 140 * DAY, fileType: "RAR archive" },
  { verdict: "remove", confidence: 0.98, category: "package-cache", reason: "pip download cache, re-downloads what it needs", size: 3.71 * GB, path: `${HOME}\\AppData\\Local\\pip\\cache`, kind: "dir", files: 21480, mtime: now - 2 * DAY },
  { verdict: "remove", confidence: 0.99, category: "partial-download", reason: "Unfinished download, untouched for 81 days", size: 3.44 * GB, path: `${HOME}\\Downloads\\Unconfirmed 633898.crdownload`, kind: "file", mtime: now - 81 * DAY },
  { verdict: "remove", confidence: 0.97, category: "package-cache", reason: "npm download cache, re-downloads what it needs", size: 2.73 * GB, path: `${HOME}\\AppData\\Local\\npm-cache`, kind: "dir", files: 61322, mtime: now - 1 * DAY },
  { verdict: "remove", confidence: 0.95, category: "temp", reason: "Temporary data an app left behind over a week ago", size: 1.18 * GB, path: `${HOME}\\AppData\\Local\\Temp\\{4F2A7C1E-93B1-4D22-A8E0-1C6A2B7D9E10}`, kind: "dir", files: 912, mtime: now - 23 * DAY },
  { verdict: "remove", confidence: 0.96, category: "node-modules", reason: "Project dependencies, reinstall anytime with npm install", size: 0.97 * GB, path: `${HOME}\\code\\storefront\\node_modules`, kind: "dir", files: 48211, mtime: now - 12 * DAY },
  { verdict: "remove", confidence: 0.94, category: "app-cache", reason: "Shader cache the graphics driver rebuilds on its own", size: 0.95 * GB, path: `${HOME}\\AppData\\Local\\NVIDIA\\DXCache`, kind: "dir", files: 812, mtime: now - 3 * DAY },
  { verdict: "remove", confidence: 0.96, category: "node-modules", reason: "Project dependencies, reinstall anytime with npm install", size: 0.74 * GB, path: `${HOME}\\code\\motion-graphics\\node_modules`, kind: "dir", files: 39004, mtime: now - 30 * DAY },
  { verdict: "remove", confidence: 0.95, category: "node-modules", reason: "Project dependencies, reinstall anytime with npm install", size: 0.7 * GB, path: `${HOME}\\code\\video-engine\\node_modules`, kind: "dir", files: 35110, mtime: now - 45 * DAY },
  { verdict: "remove", confidence: 0.93, category: "build-output", reason: "Next.js build output, rebuilt on the next build", size: 0.56 * GB, path: `${HOME}\\code\\storefront\\.next`, kind: "dir", files: 3302, mtime: now - 12 * DAY },
  { verdict: "remove", confidence: 0.92, category: "app-cache", reason: "Chrome code cache, rebuilt automatically", size: 0.38 * GB, path: `${HOME}\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\Code Cache`, kind: "dir", files: 4120, mtime: now - DAY },
  { verdict: "remove", confidence: 0.97, category: "duplicate", reason: "Exact copy of an installer kept in Downloads", size: 354 * MB, path: `${HOME}\\Downloads\\blender-5.1.2-windows-x64 (1).msi`, duplicateOf: `${HOME}\\Downloads\\blender-5.1.2-windows-x64.msi`, kind: "file", mtime: now - 44 * DAY, fileType: "Old Office document or MSI installer" },
  { verdict: "remove", confidence: 0.97, category: "duplicate", reason: "Exact copy of a screen recording kept in Videos", size: 297 * MB, path: `${HOME}\\Downloads\\screen-recording-0918 (1).mp4`, duplicateOf: `${HOME}\\Videos\\screen-recording-0918.mp4`, kind: "file", mtime: now - 19 * DAY, fileType: "MP4 or MOV video" },
  { verdict: "remove", confidence: 0.94, category: "crash-dump", reason: "Crash dump, only useful for debugging an old crash", size: 31 * MB, path: `${HOME}\\AppData\\Local\\CrashDumps\\game.exe.4412.dmp`, kind: "file", mtime: now - 15 * DAY },
  { verdict: "remove", confidence: 0.9, category: "python-cache", reason: "Python bytecode cache, recreated automatically", size: 1.2 * MB, path: `${HOME}\\code\\forecast-model\\__pycache__`, kind: "dir", files: 14, mtime: now - 6 * DAY },
  { verdict: "remove", confidence: 0.99, category: "temp-file", reason: "Lock file an Office app left behind", size: 162, path: `${HOME}\\Documents\\~$Q3 report.docx`, kind: "file", mtime: now - 6 * DAY },
  { verdict: "review", confidence: 0.71, category: "cache-file", reason: "Flight Simulator cache; the game no longer looks installed", size: 16 * GB, path: `${HOME}\\AppData\\Roaming\\Microsoft Flight Simulator 2024\\ROLLINGCACHE.CCC`, kind: "file", mtime: now - 160 * DAY },
  { verdict: "review", confidence: 0.66, category: "python-venv", reason: "Python virtual environment, rebuild it with pip install", size: 4.76 * GB, path: `${HOME}\\code\\forecast-model\\.venv312`, kind: "dir", files: 52811, mtime: now - 60 * DAY },
  { verdict: "review", confidence: 0.74, category: "installer", reason: "Installer from 52 days ago, you can download it again", size: 3.45 * GB, path: `${HOME}\\Downloads\\DaVinci_Resolve_21.0.3_Windows.exe`, kind: "file", mtime: now - 52 * DAY, fileType: "Windows program or library" },
  { verdict: "review", confidence: 0.69, category: "extracted-archive", reason: "Already extracted to the \"trip-photos\" folder next to it", size: 1.53 * GB, path: `${HOME}\\Downloads\\trip-photos.zip`, kind: "file", mtime: now - 70 * DAY, fileType: "ZIP-based archive (zip, docx, xlsx, apk, jar)" },
  { verdict: "review", confidence: 0.63, category: "old-app-version", reason: "Older app version, the newest one is 9.3.0.3970", size: 1.49 * GB, path: `${HOME}\\AppData\\Local\\CapCut\\Apps\\8.3.0.3497`, kind: "dir", files: 611, mtime: now - 90 * DAY },
  { verdict: "review", confidence: 0.72, category: "installer", reason: "Installer from 44 days ago, you can download it again", size: 0.91 * GB, path: `${HOME}\\Downloads\\nvidia-driver-610.88-win11.exe`, kind: "file", mtime: now - 44 * DAY, fileType: "Windows program or library" },
  { verdict: "review", confidence: 0.58, category: "duplicate", reason: "Exact copy of dinner.jpg in Pictures, possibly a deliberate backup", size: 6.1 * MB, path: `${HOME}\\Pictures\\Backup\\dinner.jpg`, duplicateOf: `${HOME}\\Pictures\\dinner.jpg`, kind: "file", mtime: now - 100 * DAY, fileType: "JPEG image" },
  { verdict: "review", confidence: 0.6, category: "old-log", reason: "Log file, last written 64 days ago", size: 48 * MB, path: `${HOME}\\code\\storefront\\logs\\server.log`, kind: "file", mtime: now - 64 * DAY, fileType: "text" },
];

const makeScan = (): ScanResult => ({
  roots: [HOME],
  entries: seed.map((s, i) => ({ ...s, id: i + 1, status: "pending" })),
  stats: { files: 1_231_967, dirs: 61_528, bytes: 190.49 * GB, errors: 3 },
  candidates: 503,
  checked: 400,
  aiTotal: 400,
  aiError: null,
  model: "gemini-3.5-flash-lite",
  classifiedBy: "local rules + gemini-3.5-flash-lite",
  leftOut: 97,
  startedAt: now - 2 * 3600_000,
  durationMs: 53_000,
  finishedAt: now - 2 * 3600_000 + 53_000,
});

let scan: ScanResult | null = makeScan();
let held: Held[] = [
  { batch: "2026-10-05", size: 1.21 * GB, original: `${HOME}\\AppData\\Local\\CapCut\\Apps\\8.2.0.3462`, held: `${HOME}\\AppData\\Local\\cleaner\\hold\\2026-10-05\\items\\0004-8.2.0.3462` },
  { batch: "2026-10-05", size: 640 * MB, original: `${HOME}\\Downloads\\obs-studio-31.1-setup.exe`, held: `${HOME}\\AppData\\Local\\cleaner\\hold\\2026-10-05\\items\\0011-obs-studio-31.1-setup.exe` },
  { batch: "2026-10-06", size: 212 * MB, original: `${HOME}\\Videos\\clip-draft-03.mp4`, held: `${HOME}\\AppData\\Local\\cleaner\\hold\\2026-10-06\\items\\0002-clip-draft-03.mp4` },
];

const iso = (msAgo: number) => new Date(now - msAgo).toISOString();
let activity: AuditEntry[] = [
  { time: iso(2 * 3600_000), action: "scan", app: "desktop", user: "alex", machine: "ALEX-PC", roots: [HOME], files: 1_231_967, bytes: 190.49 * GB, found: 24, classifiedBy: "local rules + gemini-3.5-flash-lite" },
  { time: iso(26 * 3600_000), action: "hold", app: "desktop", user: "alex", machine: "ALEX-PC", count: 1, bytes: 212 * MB, items: [{ path: `${HOME}\\Videos\\clip-draft-03.mp4`, size: 212 * MB, result: "held" }] },
  { time: iso(27 * 3600_000), action: "delete", app: "desktop", user: "alex", machine: "ALEX-PC", count: 12, bytes: 9.84 * GB, items: [{ path: `${HOME}\\AppData\\Local\\Packages\\…\\LocalCache\\EBWebView\\Default\\Cache`, size: 2.1 * GB, result: "removed" }, { path: `${HOME}\\Downloads\\Unconfirmed 784268.crdownload`, size: 480 * MB, result: "removed" }] },
  { time: iso(28 * 3600_000), action: "map", app: "desktop", user: "alex", machine: "ALEX-PC", root: "C:\\", files: 2_523_156, bytes: 360.85 * GB },
  { time: iso(2 * DAY), action: "hold", app: "cli", user: "alex", machine: "ALEX-PC", count: 2, bytes: 1.85 * GB, items: [{ path: `${HOME}\\AppData\\Local\\CapCut\\Apps\\8.2.0.3462`, size: 1.21 * GB, result: "held" }] },
  { time: iso(2 * DAY + 600_000), action: "scan", app: "cli", user: "alex", machine: "ALEX-PC", roots: [HOME], files: 1_229_401, bytes: 189.9 * GB, found: 31, classifiedBy: "local rules + gemini-3.5-flash-lite" },
  { time: iso(3 * DAY - 1800_000), action: "organize", app: "desktop", user: "alex", machine: "ALEX-PC", root: `${HOME}\\Downloads`, count: 48, bytes: 3.1 * GB },
  { time: iso(3 * DAY), action: "settings", app: "desktop", user: "alex", machine: "ALEX-PC", changed: ["geminiKey"] },
  { time: iso(3 * DAY + 900_000), action: "export", app: "desktop", user: "alex", machine: "ALEX-PC", kind: "report-html", file: `${HOME}\\Documents\\cleaner-report-2026-10-04.html` },
];

const explained: Record<string, Explanation> = {
  "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Cyberpunk 2077": { label: "Cyberpunk 2077 (game)", kind: "game", advice: "check", tip: "Uninstall it from Steam if you finished it; cloud saves stay safe." },
  "C:\\Windows": { label: "Windows system files", kind: "system", advice: "keep", tip: "Let Storage Sense or Disk Cleanup trim it. Never delete by hand." },
  "C:\\Program Files\\Epic Games\\UE_5.5": { label: "Unreal Engine 5.5 (game engine)", kind: "dev-tool", advice: "reclaim", tip: "Uninstall it from the Epic Games Launcher if you no longer build games." },
  [`${HOME}\\Videos\\Recordings`]: { label: "Your screen recordings", kind: "user-files", advice: "keep", tip: "Move older recordings to an external drive or OneDrive." },
  "C:\\ProgramData\\Tenable\\Nessus": { label: "Nessus vulnerability scanner", kind: "dev-tool", advice: "check", tip: "Uninstall from Settings > Apps if you no longer scan networks." },
  [`${HOME}\\AppData\\Roaming\\.minecraft`]: { label: "Minecraft worlds and assets", kind: "game", advice: "keep", tip: "Holds your worlds. Back up saves before removing anything." },
  "C:\\Program Files\\Unity\\Hub": { label: "Unity editors", kind: "dev-tool", advice: "check", tip: "Remove editor versions you no longer use from Unity Hub." },
  [`${HOME}\\Downloads`]: { label: "Downloaded files", kind: "downloads", advice: "check", tip: "Installers and archives you already used can usually go." },
  [`${HOME}\\AppData\\Local\\Packages\\MicrosoftTeams\\LocalCache`]: { label: "Microsoft Teams cache", kind: "cache", advice: "reclaim", tip: "Clear it from Teams settings; it rebuilds automatically." },
  [`${HOME}\\AppData\\Local\\Google\\Chrome`]: { label: "Chrome profile and cache", kind: "app", advice: "check", tip: "Clear cached images and files in Chrome to shrink it." },
  [`${HOME}\\AppData\\Local\\wsl`]: { label: "WSL Linux disk", kind: "dev-tool", advice: "keep", tip: "Compact it with wsl --manage <distro> --set-sparse true." },
  "C:\\Program Files\\Microsoft Office": { label: "Microsoft Office", kind: "app", advice: "keep", tip: "Installed apps; uninstall from Settings > Apps if unused." },
};

const unitSizes: [string, number, boolean?][] = [
  ["C:\\Program Files (x86)\\Steam\\steamapps\\common\\Cyberpunk 2077", 64.2 * GB],
  ["C:\\Windows", 39.6 * GB],
  ["C:\\Program Files\\Epic Games\\UE_5.5", 33.5 * GB],
  [`${HOME}\\Videos\\Recordings`, 29.8 * GB],
  ["C:\\ProgramData\\Tenable\\Nessus", 13.0 * GB],
  [`${HOME}\\AppData\\Roaming\\.minecraft`, 12.9 * GB],
  ["C:\\Program Files\\Unity\\Hub", 12.4 * GB],
  [`${HOME}\\Downloads`, 7.7 * GB, true],
  [`${HOME}\\AppData\\Local\\Packages\\MicrosoftTeams\\LocalCache`, 6.8 * GB],
  [`${HOME}\\AppData\\Local\\Google\\Chrome`, 7.5 * GB],
  [`${HOME}\\AppData\\Local\\wsl`, 7.2 * GB],
  ["C:\\Program Files\\Microsoft Office", 7.75 * GB],
];

const childNames: Record<string, string[]> = {
  "C:\\Windows": ["WinSxS", "System32", "assembly", "Installer", "SysWOW64", "SystemApps"],
  "C:\\Program Files\\Epic Games\\UE_5.5": ["Engine", "Templates", "Samples", "FeaturePacks"],
  "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Cyberpunk 2077": ["archive", "bin", "engine", "r6", "red4ext"],
};

function makeMap(): MapResult {
  const units = unitSizes
    .map(([path, size, loose]) => ({ path, size, loose, children: (childNames[path] ?? ["data", "cache", "assets"]).slice(0, 4).map((name, i) => ({ name, size: size * [0.46, 0.24, 0.14, 0.08][i] })) }))
    .sort((a, b) => b.size - a.size);
  return {
    root: "C:\\",
    stats: { files: 2_523_156, dirs: 418_303, bytes: 360.85 * GB, errors: 103 },
    units,
    disk: { total: 476.3 * GB, free: 61.2 * GB },
    explained: {},
    explainedBy: null,
    finishedAt: now - 28 * 3600_000,
    durationMs: 94_400,
  };
}
let map: MapResult | null = { ...makeMap(), explained, explainedBy: "gemini-3.5-flash-lite" };

let settings: SettingsView = {
  settings: { theme: "system", aiEnabled: true, previews: true, maxAi: 400, largeMB: 200, exclude: [`${HOME}\\Documents\\Taxes`], targets: [HOME] },
  locks: {},
  policy: { managed: false, organization: null, excludePaths: [], error: null, source: "C:\\ProgramData\\Cleaner\\policy.json" },
  allowPermanentDelete: true,
  key: { hasKey: true, source: "secure", hint: "AIza…9QkX" },
};

type Listener<T> = (v: T) => void;
const scanListeners = new Set<Listener<ScanEvent>>();
const mapListeners = new Set<Listener<{ type: "map"; files: number; bytes: number; current: string }>>();
const explainListeners = new Set<Listener<MapResult>>();
const actListeners = new Set<Listener<{ done: number; total: number }>>();
const on = <T,>(set: Set<Listener<T>>) => (fn: Listener<T>) => {
  set.add(fn);
  return () => set.delete(fn);
};
let cancelled = false;

const SAMPLE_PATHS = [
  `${HOME}\\AppData\\Local\\Microsoft\\Edge\\User Data\\Default\\Service Worker`,
  `${HOME}\\code\\storefront\\src\\components`,
  `${HOME}\\OneDrive\\Documents\\Invoices\\2026`,
  `${HOME}\\AppData\\Roaming\\Code\\User\\workspaceStorage`,
  `${HOME}\\Pictures\\Camera Roll\\2026\\09`,
  `${HOME}\\Videos\\Recordings`,
];

export const mockApi: CleanerApi = {
  async info(): Promise<AppInfo> {
    return { version: "1.2.1", engineVersion: "1.2.1", electron: "44.6.0", dataDir: `${HOME}\\AppData\\Local\\cleaner`, auditFile: `${HOME}\\AppData\\Local\\cleaner\\audit.jsonl`, policyFile: "C:\\ProgramData\\Cleaner\\policy.json", logFile: `${HOME}\\AppData\\Local\\cleaner\\logs\\desktop.log`, user: "alex", machine: "ALEX-PC", home: HOME };
  },
  async drives(): Promise<Drive[]> {
    return [
      { root: "C:\\", letter: "C", total: 476.3 * GB, free: 61.2 * GB },
      { root: "D:\\", letter: "D", total: 931.5 * GB, free: 512.8 * GB },
    ];
  },
  async pickFolders() {
    return [`${HOME}\\Videos`];
  },
  async reveal() {
    return true;
  },
  async openExternal() {
    return true;
  },
  async openPath() {
    return true;
  },
  async getSettings() {
    return settings;
  },
  async setSettings(patch) {
    settings = { ...settings, settings: { ...settings.settings, ...patch } };
    return settings;
  },
  async setKey(key) {
    await wait(700);
    if (key.length < 20) return { ok: false, message: "API key not valid. Please pass a valid API key." };
    settings = { ...settings, key: { hasKey: true, source: "secure", hint: `${key.slice(0, 4)}…${key.slice(-4)}` } };
    return { ok: true, ...settings };
  },
  async clearKey() {
    settings = { ...settings, key: { hasKey: false, source: null, hint: null } };
    return settings;
  },
  async lastScan() {
    return scan;
  },
  async startScan() {
    cancelled = false;
    const emit = (ev: ScanEvent) => scanListeners.forEach((fn) => fn(ev));
    const total = 1_231_967;
    for (let i = 1; i <= 40; i++) {
      if (cancelled) return { ok: false, cancelled: true };
      await wait(70);
      emit({ type: "walk", files: Math.round((total * i) / 40), bytes: (190.49 * GB * i) / 40, current: SAMPLE_PATHS[i % SAMPLE_PATHS.length] });
    }
    emit({ type: "walked", files: total, bytes: 190.49 * GB, dirs: 61_528, errors: 3, ms: 41_200 });
    for (let i = 1; i <= 12; i++) {
      await wait(60);
      emit({ type: "hash", done: (7.4 * GB * i) / 12, total: 7.4 * GB });
    }
    emit({ type: "hashed", copies: 107, bytes: 7.4 * GB });
    emit({ type: "inspected", files: 469, previews: 41, sensitive: 1 });
    for (let i = 0; i <= 10; i++) {
      if (cancelled) return { ok: false, cancelled: true };
      await wait(140);
      emit({ type: "ai", done: i * 40, total: 400 });
    }
    emit({ type: "aiDone", checked: 400, total: 400, model: "gemini-3.5-flash-lite", error: null });
    scan = { ...makeScan(), startedAt: Date.now() - 53_000, finishedAt: Date.now() };
    return { ok: true, scan };
  },
  async cancelScan() {
    cancelled = true;
    return true;
  },
  onScanEvent: on(scanListeners),
  async act({ ids, action }) {
    if (!scan) throw new Error("no scan");
    const chosen = scan.entries.filter((e) => ids.includes(e.id) && e.status === "pending");
    for (const [i, e] of chosen.entries()) {
      await wait(30);
      e.status = action === "hold" ? "held" : "removed";
      actListeners.forEach((fn) => fn({ done: i + 1, total: chosen.length }));
    }
    scan = { ...scan, entries: [...scan.entries] };
    const freed = action === "delete" ? chosen.reduce((s, e) => s + e.size, 0) : 0;
    return { ok: true, done: chosen.length, failed: 0, blocked: 0, freed, entries: scan.entries };
  },
  onActProgress: on(actListeners),
  async exportScript() {
    return { ps1: `${HOME}\\Desktop\\cleaner-remove.ps1`, bat: `${HOME}\\Desktop\\cleaner-remove.bat`, safe: 16, yours: 8 };
  },
  async exportReport(format) {
    return { ok: true, file: `${HOME}\\Documents\\cleaner-report.${format}` };
  },
  async lastMap() {
    return map;
  },
  async startMap() {
    cancelled = false;
    for (let i = 1; i <= 30; i++) {
      if (cancelled) return { ok: false, cancelled: true };
      await wait(60);
      mapListeners.forEach((fn) => fn({ type: "map", files: Math.round((2_523_156 * i) / 30), bytes: (360.85 * GB * i) / 30, current: SAMPLE_PATHS[i % SAMPLE_PATHS.length] }));
    }
    map = { ...makeMap(), finishedAt: Date.now() };
    setTimeout(() => {
      map = { ...(map as MapResult), explained, explainedBy: "gemini-3.5-flash-lite" };
      explainListeners.forEach((fn) => fn(map as MapResult));
    }, 1400);
    return { ok: true, map, aiPending: true };
  },
  async cancelMap() {
    cancelled = true;
    return true;
  },
  onMapEvent: on(mapListeners),
  onMapExplained: on(explainListeners),
  async mapChildren(path): Promise<MapChildren | null> {
    const unit = map?.units.find((u) => u.path === path);
    const size = unit?.size ?? 4 * GB;
    const names = childNames[path] ?? ["data", "cache", "assets", "logs", "plugins", "config"];
    const shares = [0.34, 0.22, 0.14, 0.1, 0.07, 0.05];
    const children = names.slice(0, 6).map((name, i) => ({ path: `${path}\\${name}`, name, size: size * shares[i] }));
    return { path, size, loose: size - children.reduce((s, c) => s + c.size, 0), children };
  },
  async listHeld() {
    return held;
  },
  async restoreHeld(paths) {
    const before = held.length;
    held = held.filter((h) => !paths.includes(h.held));
    return { restored: before - held.length, conflicts: 0, failed: 0 };
  },
  async purgeHeld(paths) {
    const gone = held.filter((h) => paths.includes(h.held));
    held = held.filter((h) => !paths.includes(h.held));
    return { purged: gone.length, failed: 0, freed: gone.reduce((s, h) => s + h.size, 0) };
  },
  async listActivity() {
    return activity;
  },
  async exportActivity() {
    activity = [...activity];
    return { ok: true, file: `${HOME}\\Documents\\cleaner-activity.csv` };
  },
  ...extraMock,
  ...protectMock,
  ...networkMock,
};
