// Sample data for the Protection page in demo mode. All made up; nothing here touches a disk.
import type { Behavior, CleanerApi, IntelFeed, ProtectStatus, Quarantined, StartupEntry, ThreatEvent, ThreatResult, ThreatScan, WatchEvent } from "./types";

const HOME = "C:\\Users\\alex";
const MB = 1024 ** 2;
const DAY = 86_400_000;
const now = Date.now();
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const f = (id: string, weight: number, label: string, detail: string | null = null, counted = true) => ({ id, weight, label, detail, counted });
const hash = (seed: string) => Array.from({ length: 64 }, (_, i) => "0123456789abcdef"[(seed.charCodeAt(i % seed.length) * (i + 7)) % 16]).join("");

const results: ThreatResult[] = [
  {
    id: 1, path: `${HOME}\\Downloads\\invoice_8841.pdf.exe`, name: "invoice_8841.pdf.exe", size: 1.4 * MB, mtime: now - 2 * 3600_000, kind: "pe", sha256: hash("invoice"),
    severity: "threat", score: 10,
    findings: [f("double-extension", 5, "Hides a program behind a document name", "invoice_8841.pdf.exe"), f("stealer", 3, "Refers to saved browser passwords and cookies"), f("from-internet", 1, "Downloaded from the internet", "https://mail-attachments.example.net/a/8841"), f("unsigned", 1, "Not digitally signed by its publisher")],
    detections: [{ source: "malwarebazaar", name: "Known malware sample: AgentTesla" }, { source: "yara", name: "MAL AgentTesla Mar23: Detects AgentTesla information stealer" }],
    signer: { status: "none", subject: null }, zone: { id: 3, url: "https://mail-attachments.example.net/a/8841" }, autostart: null, ai: null,
    reputation: [{ source: "malwarebazaar", found: true, label: "AgentTesla" }], trusted: false, status: "found",
  },
  {
    id: 2, path: `${HOME}\\Desktop\\eicar.com`, name: "eicar.com", size: 68, mtime: now - 3 * DAY, kind: "other", sha256: "275a021bbfb6489e54d471899f7db9d1663fc695ec2fe2a2c4538aabf651fd0f",
    severity: "threat", score: 0, findings: [],
    detections: [{ source: "hash", name: "EICAR test file (harmless, used to check antivirus software)" }],
    signer: null, zone: null, autostart: null, ai: null, reputation: [], trusted: false, status: "found",
  },
  {
    id: 3, path: `${HOME}\\AppData\\Roaming\\SysHelper\\svchost.exe`, name: "svchost.exe", size: 612 * 1024, mtime: now - 9 * DAY, kind: "pe", sha256: hash("svchost"),
    severity: "suspicious", score: 11,
    findings: [f("injection", 3, "Can write code into other running programs"), f("autostart-writable", 3, "Starts with Windows from a folder any program can write to", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run"), f("packed-code", 2, "Its code section looks encrypted or compressed", ".text entropy 7.81"), f("exe-in-odd-place", 1, "A program installed into AppData\\Roaming"), f("unsigned", 1, "Not digitally signed by its publisher")],
    detections: [], signer: { status: "none", subject: null }, zone: null,
    autostart: { id: 4, source: "registry", location: "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", name: "SysHelper", command: `"${HOME}\\AppData\\Roaming\\SysHelper\\svchost.exe" -silent`, target: `${HOME}\\AppData\\Roaming\\SysHelper\\svchost.exe`, missing: false, publisher: null, lolbin: null },
    ai: { verdict: "likely-malicious", confidence: 0.84, reason: "A svchost.exe outside Windows that starts at login is a classic disguise" },
    reputation: [], trusted: false, status: "found",
  },
  {
    id: 4, path: `${HOME}\\Downloads\\Order_Confirmation.lnk`, name: "Order_Confirmation.lnk", size: 2.3 * 1024, mtime: now - 26 * 3600_000, kind: "lnk", sha256: hash("order"),
    severity: "suspicious", score: 8,
    findings: [f("shortcut-command", 4, "A shortcut that secretly runs powershell"), f("download-exec", 3, "Downloads and runs code from the internet"), f("from-internet", 1, "Downloaded from the internet", "https://files.example.org/share/9ac2")],
    detections: [], signer: null, zone: { id: 3, url: "https://files.example.org/share/9ac2" }, autostart: null,
    ai: { verdict: "likely-malicious", confidence: 0.9, reason: "Order shortcuts that start PowerShell are a common phishing trick" },
    reputation: [], trusted: false, status: "found",
  },
  {
    id: 5, path: `${HOME}\\Downloads\\Q3_pricing.xlsm`, name: "Q3_pricing.xlsm", size: 88 * 1024, mtime: now - 4 * DAY, kind: "zip", sha256: hash("pricing"),
    severity: "suspicious", score: 6,
    findings: [f("auto-macro", 2, "Its macros run as soon as the document opens"), f("macro-shell", 2, "Its macros can start programs or download files"), f("macros", 1, "Contains Office macros"), f("from-internet", 1, "Downloaded from the internet", "https://outlook.office.com")],
    detections: [], signer: null, zone: { id: 3, url: "https://outlook.office.com" }, autostart: null,
    ai: { verdict: "unclear", confidence: 0.55, reason: "Pricing sheets can use macros legitimately; check who sent it" },
    reputation: [], trusted: false, status: "found",
  },
  {
    id: 6, path: `${HOME}\\Downloads\\CheatEngine76.exe`, name: "CheatEngine76.exe", size: 29 * MB, mtime: now - 40 * DAY, kind: "pe", sha256: hash("cheat"),
    severity: "notice", score: 4,
    findings: [f("injection", 3, "Can write code into other running programs"), f("unsigned", 1, "Not digitally signed by its publisher"), f("from-internet", 1, "Downloaded from the internet", "https://github.com")],
    detections: [], signer: { status: "none", subject: null }, zone: { id: 3, url: "https://github.com" }, autostart: null,
    ai: { verdict: "likely-benign", confidence: 0.78, reason: "Cheat Engine, a well-known game memory tool, behaves like this" },
    reputation: [], trusted: false, status: "found",
  },
  {
    id: 7, path: `${HOME}\\AppData\\Local\\Temp\\~nsu.tmp\\Un_A.exe`, name: "Un_A.exe", size: 210 * 1024, mtime: now - 12 * DAY, kind: "pe", sha256: hash("una"),
    severity: "notice", score: 3,
    findings: [f("exe-in-odd-place", 2, "A program running from a temp folder"), f("unsigned", 1, "Not digitally signed by its publisher")],
    detections: [], signer: { status: "none", subject: null }, zone: null, autostart: null, ai: null, reputation: [], trusted: false, status: "found",
  },
];

const st = (id: number, source: StartupEntry["source"], location: string, name: string, target: string | null, signer: string | null, severity: StartupEntry["severity"] = "clean", reasons: string[] = [], missing = false): StartupEntry => ({
  id, source, location, name, command: target ? `"${target}"` : "", target, missing, publisher: null, lolbin: null,
  signer: signer ? { status: "valid", subject: signer } : missing ? null : { status: "none", subject: null }, severity, reasons,
});
const RUN = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const startups: StartupEntry[] = [
  st(4, "registry", RUN, "SysHelper", `${HOME}\\AppData\\Roaming\\SysHelper\\svchost.exe`, null, "suspicious", ["Can write code into other running programs", "Starts with Windows from a folder any program can write to", "Not digitally signed by its publisher"]),
  st(1, "registry", RUN, "OneDrive", `${HOME}\\AppData\\Local\\Microsoft\\OneDrive\\OneDrive.exe`, "Microsoft Corporation"),
  st(2, "registry", RUN, "Discord", `${HOME}\\AppData\\Local\\Discord\\Update.exe`, "Discord Inc."),
  st(3, "registry", RUN, "Spotify", `${HOME}\\AppData\\Roaming\\Spotify\\Spotify.exe`, "Spotify AB"),
  st(5, "registry", "HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "SecurityHealth", "C:\\Windows\\System32\\SecurityHealthSystray.exe", "Microsoft Windows"),
  st(6, "registry", "HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run", "Steam", "C:\\Program Files (x86)\\Steam\\steam.exe", "Valve Corp."),
  st(7, "startup-folder", `${HOME}\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup`, "Notion.lnk", `${HOME}\\AppData\\Local\\Programs\\Notion\\Notion.exe`, "Notion Labs, Inc"),
  st(8, "task", "\\", "GoogleUpdaterTaskSystem", "C:\\Program Files (x86)\\Google\\GoogleUpdater\\updater.exe", "Google LLC"),
  st(9, "task", "\\", "MicrosoftEdgeUpdateTaskMachineUA", "C:\\Program Files (x86)\\Microsoft\\EdgeUpdate\\MicrosoftEdgeUpdate.exe", "Microsoft Corporation"),
  st(10, "task", "\\NVIDIA\\", "NvTmRep_CrashReport1", "C:\\Program Files\\NVIDIA Corporation\\NvContainer\\nvtmrep.exe", "NVIDIA Corporation"),
  st(11, "service", "Services", "Steam Client Service", "C:\\Program Files (x86)\\Common Files\\Steam\\steamservice.exe", "Valve Corp."),
  st(12, "service", "Services", "Razer Synapse Service", "C:\\Program Files (x86)\\Razer\\Synapse3\\Service\\Razer Synapse Service.exe", "Razer USA Ltd."),
  st(13, "registry", RUN, "Adobe Creative Cloud", "C:\\Program Files\\Adobe\\Adobe Creative Cloud\\ACC\\Creative Cloud.exe", null, "missing", [], true),
  st(14, "task", "\\", "OldGameLauncher_Update", "C:\\Games\\OldLauncher\\updater.exe", null, "missing", [], true),
  st(15, "winlogon", "Winlogon", "Shell", "explorer.exe", null),
];

const live: Behavior = {
  processes: [
    {
      pid: 7344, ppid: 5120, name: "svchost.exe", path: `${HOME}\\AppData\\Roaming\\SysHelper\\svchost.exe`, cmd: "svchost.exe -silent", parentName: "explorer.exe", started: new Date(now - 5 * 3600_000).toISOString(),
      signer: { status: "none", subject: null }, severity: "threat", score: 11, external: 2, listening: [],
      detections: [{ source: "feodo", name: "Connected to a known botnet server 203.0.113.42:443 (QakBot)" }],
      findings: [f("masquerade", 6, "Uses the name of a Windows process (svchost.exe) from the wrong folder", `${HOME}\\AppData\\Roaming\\SysHelper\\svchost.exe`), f("phones-out", 2, "Talks to 2 internet addresses", "203.0.113.42, 198.51.100.7"), f("unsigned", 1, "Not digitally signed")],
    },
    {
      pid: 9120, ppid: 8812, name: "powershell.exe", path: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", cmd: "powershell.exe -nop -w hidden -enc UwB0AGEAcgB0AC0AUAByAG8AYwBlAHMAcwAgAC4ALgAuAA==", parentName: "WINWORD.EXE", started: new Date(now - 40 * 60_000).toISOString(),
      signer: { status: "valid", subject: "Microsoft Windows" }, severity: "suspicious", score: 8, external: 0, listening: [], detections: [],
      findings: [f("office-child", 5, "WINWORD.EXE started powershell.exe, a common macro-malware move"), f("encoded-command", 3, "Runs a hidden, encoded PowerShell command", "Start-Process 'C:\\Users\\Public\\upd.exe' -WindowStyle Hidden")],
    },
  ],
  drivers: [{ name: "AsIO2", display: "ASUS IO driver", path: "C:\\Windows\\System32\\drivers\\AsIO2.sys", sha256: null, severity: "suspicious", label: "A driver known to be abused to switch off security software (LOLDrivers: AsIO2.sys)" }],
  stats: { processes: 287, external: 41, listening: 52, drivers: 196, talkers: 13 },
};
const feed = (label: string, count: number): IntelFeed => ({ label, count, updated: new Date(now - 2 * 3600_000).toISOString(), stale: false });
const intel = { malwareBazaar: feed("MalwareBazaar recent samples", 1310), urlhaus: feed("URLhaus malware hosts", 401), feodo: feed("Feodo Tracker botnet servers", 5), lolDrivers: feed("LOLDrivers", 2302) };

const makeScan = (finishedAt: number): ThreatScan => ({
  mode: "quick",
  roots: [`${HOME}\\Downloads`, `${HOME}\\Desktop`, `${HOME}\\AppData\\Local\\Temp`, `${HOME}\\AppData\\Roaming`],
  startedAt: finishedAt - 61_000,
  durationMs: 61_000,
  finishedAt,
  stats: { filesSeen: 8_405, inspected: 2_840, programs: 489, signed: 603, startups: startups.length, threats: 2, suspicious: 3, notices: 2 },
  engines: { rules: true, hashList: true, defender: true, malwareBazaar: true, virusTotal: false, gemini: true, defenderReason: null, model: "gemini-3.5-flash-lite", aiError: null, intel, yara: { rules: 3412, release: "20261004" }, hashlookup: true, behavior: true },
  results: results.map((r) => ({ ...r })),
  startups,
  behavior: live,
  errors: [],
});

let scan: ThreatScan | null = makeScan(now - 3 * 3600_000);
let status: ProtectStatus = {
  defender: { available: true, mode: "Normal", engine: "1.1.24090.11", updated: new Date(now - 5 * 3600_000).toISOString(), reason: null },
  keys: { malwareBazaar: { hasKey: true, source: "secure", hint: "4f2a…9c1e" }, virusTotal: { hasKey: false, source: null, hint: null } },
  knownHashes: 1,
  quarantined: 1,
  intel,
  yara: { ready: true, engine: { version: "v4.5.5", installed: new Date(now - 3 * 86_400_000).toISOString() }, rules: { release: "20261004", installed: new Date(now - 3 * 86_400_000).toISOString(), count: 3412 } },
  online: true,
  watching: true,
};
let watch: WatchEvent[] = [
  { id: 2, time: new Date(now - 25 * 60_000).toISOString(), kind: "file", path: `${HOME}\\Downloads\\Payment_Details.zip`, name: "Payment_Details.zip", severity: "suspicious", reason: "A zip hiding a program behind a document name", sha256: hash("payzip"), size: 412_000, status: "found" },
  { id: 1, time: new Date(now - 26 * 3600_000).toISOString(), kind: "startup", path: `${HOME}\\AppData\\Roaming\\SysHelper\\svchost.exe`, name: "SysHelper", severity: "suspicious", reason: "Starts with Windows from a folder any program can write to", sha256: null, size: 0, status: "found" },
];
let quarantine: Quarantined[] = [
  { id: "2026-10-05T19-02-11-412Z-a1b2c3", original: `${HOME}\\Downloads\\free-robux-generator.exe`, size: 3.2 * MB, sha256: hash("robux"), reason: "Known malware sample: RedLine Stealer", severity: "threat", time: new Date(now - 2 * DAY).toISOString() },
];
const listeners = new Set<(e: ThreatEvent) => void>();
const setupListeners = new Set<(e: { step: string }) => void>();
let cancelled = false;

export const protectMock: Pick<
  CleanerApi,
  "protectStatus" | "lastThreatScan" | "startThreatScan" | "cancelThreatScan" | "onThreatEvent" | "quarantineItems" | "trustItem" | "lookupItem" | "listQuarantine" | "restoreQuarantine" | "deleteQuarantine" | "setServiceKey" | "clearServiceKey" | "updateIntel" | "setupYara" | "onSetupEvent" | "endProcess" | "watchEvents" | "onWatchEvent" | "watchQuarantine" | "watchDismiss"
> = {
  async protectStatus() {
    return { ...status, quarantined: quarantine.length };
  },
  async lastThreatScan() {
    return scan;
  },
  async startThreatScan() {
    cancelled = false;
    const emit = (e: ThreatEvent) => listeners.forEach((fn) => fn(e));
    emit({ type: "phase", phase: "intel" });
    await wait(400);
    emit({ type: "phase", phase: "autostart" });
    await wait(500);
    emit({ type: "autostart", count: startups.length });
    emit({ type: "phase", phase: "walk" });
    for (let i = 1; i <= 10; i++) {
      if (cancelled) return { ok: false, cancelled: true };
      await wait(70);
      emit({ type: "walk", files: i * 840, candidates: i * 284, current: [`${HOME}\\Downloads`, `${HOME}\\AppData\\Roaming\\Spotify`, `${HOME}\\AppData\\Local\\Temp`][i % 3] });
    }
    emit({ type: "phase", phase: "inspect" });
    for (let i = 1; i <= 20; i++) {
      if (cancelled) return { ok: false, cancelled: true };
      await wait(90);
      emit({ type: "inspect", done: i * 142, total: 2840, current: `${HOME}\\Downloads\\${["setup.exe", "Order_Confirmation.lnk", "Q3_pricing.xlsm", "invoice_8841.pdf.exe"][i % 4]}` });
    }
    emit({ type: "phase", phase: "signatures" });
    await wait(700);
    emit({ type: "signatures", checked: 603 });
    emit({ type: "phase", phase: "defender" });
    for (let i = 1; i <= 6; i++) {
      await wait(80);
      emit({ type: "defender", done: i * 6, total: 36 });
    }
    emit({ type: "phase", phase: "reputation" });
    await wait(500);
    emit({ type: "phase", phase: "yara" });
    await wait(500);
    emit({ type: "phase", phase: "ai" });
    await wait(600);
    emit({ type: "phase", phase: "behavior" });
    await wait(500);
    scan = makeScan(Date.now());
    return { ok: true, scan };
  },
  async cancelThreatScan() {
    cancelled = true;
    return true;
  },
  onThreatEvent(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  async quarantineItems(ids) {
    await wait(300);
    if (!scan) throw new Error("no scan");
    let done = 0;
    for (const r of scan.results) {
      if (!ids.includes(r.id) || r.status !== "found") continue;
      r.status = "quarantined";
      quarantine = [{ id: `${Date.now()}-${r.id}`, original: r.path, size: r.size, sha256: r.sha256, reason: r.detections[0]?.name ?? r.findings[0]?.label ?? null, severity: r.severity, time: new Date().toISOString() }, ...quarantine];
      done++;
    }
    scan = { ...scan, results: [...scan.results] };
    return { done, failed: [], scan };
  },
  async trustItem(id) {
    if (!scan) throw new Error("no scan");
    scan = { ...scan, results: scan.results.map((r) => (r.id === id ? { ...r, status: "trusted", trusted: true } : r)) };
    return scan;
  },
  async lookupItem(id) {
    await wait(600);
    if (!scan) throw new Error("no scan");
    const result = { source: "virustotal" as const, found: true, malicious: id <= 4 ? 41 : 0, suspicious: 1, total: 72, label: id <= 4 ? "trojan.agenttesla/msil" : null };
    scan = { ...scan, results: scan.results.map((r) => (r.id === id ? { ...r, reputation: [...r.reputation.filter((x) => x.source !== "virustotal"), result] } : r)) };
    return { opened: false, result, scan };
  },
  async listQuarantine() {
    return quarantine;
  },
  async restoreQuarantine(id) {
    quarantine = quarantine.filter((q) => q.id !== id);
    return quarantine;
  },
  async deleteQuarantine(id) {
    quarantine = quarantine.filter((q) => q.id !== id);
    return quarantine;
  },
  async setServiceKey({ name }) {
    status = { ...status, keys: { ...status.keys, [name]: { hasKey: true, source: "secure", hint: "demo…key0" } } };
    return { ok: true, status };
  },
  async updateIntel() {
    for (const step of ["MalwareBazaar recent samples", "URLhaus malware hosts", "Feodo Tracker botnet servers", "LOLDrivers"]) {
      setupListeners.forEach((fn) => fn({ step }));
      await wait(250);
    }
    return { report: { malwareBazaar: { ok: true, count: 1310 } }, status };
  },
  async setupYara() {
    for (const step of ["engine", "rules", "compile"]) {
      setupListeners.forEach((fn) => fn({ step }));
      await wait(400);
    }
    return status;
  },
  onSetupEvent(fn) {
    setupListeners.add(fn);
    return () => setupListeners.delete(fn);
  },
  async endProcess(pid) {
    if (!scan?.behavior) throw new Error("no snapshot");
    scan = { ...scan, behavior: { ...scan.behavior, processes: scan.behavior.processes.map((p) => (p.pid === pid ? { ...p, ended: true } : p)) } };
    return { ok: true, scan };
  },
  async watchEvents() {
    return watch;
  },
  onWatchEvent() {
    return () => {};
  },
  async watchQuarantine(id) {
    watch = watch.map((e) => (e.id === id ? { ...e, status: "quarantined" } : e));
    return watch;
  },
  async watchDismiss(id) {
    watch = watch.map((e) => (e.id === id ? { ...e, status: "dismissed" } : e));
    return watch;
  },
  async clearServiceKey(name) {
    status = { ...status, keys: { ...status.keys, [name]: { hasKey: false, source: null, hint: null } } };
    return status;
  },
};
