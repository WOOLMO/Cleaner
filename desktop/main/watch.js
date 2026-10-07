import fs from "node:fs";
import path from "node:path";
import { app, BrowserWindow, Notification } from "electron";
import * as engine from "./engine.js";
import { log } from "./log.js";

// Watch mode: while Cleaner is open, new files where downloads land (Downloads, Desktop, the Startup
// folder) are checked the moment they appear, and the startup list is compared with a baseline every
// ten minutes. Anything suspicious raises a Windows notification. Nothing is moved automatically.

const EVENTS_FILE = path.join(engine.DATA_DIR, "watch-events.json");
const BASELINE_FILE = path.join(engine.DATA_DIR, "startup-baseline.json");
const SETTLE_MS = 2500;
const STARTUP_EVERY = 10 * 60_000;

let watchers = [];
let timers = new Map();
let startupTimer = null;
let events = readEvents();
let nextId = events.reduce((m, e) => Math.max(m, e.id), 0) + 1;

function readEvents() {
  try {
    return JSON.parse(fs.readFileSync(EVENTS_FILE, "utf8"));
  } catch {
    return [];
  }
}
function saveEvents() {
  fs.mkdirSync(engine.DATA_DIR, { recursive: true });
  fs.writeFileSync(EVENTS_FILE, JSON.stringify(events.slice(0, 60)), "utf8");
}

export const watchEvents = () => events;
export const watching = () => watchers.length > 0;

function emit(event) {
  events = [event, ...events].slice(0, 60);
  saveEvents();
  engine.audit("watch", { app: "desktop", items: [{ path: event.path, size: event.size ?? 0, result: `${event.severity}: ${event.reason}` }] });
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send("protect:watchEvent", event);
  if (Notification.isSupported()) {
    const n = new Notification({
      title: event.kind === "startup" ? "New program set to start with Windows" : event.severity === "threat" ? "Cleaner found a threat" : "Cleaner found a suspicious file",
      body: `${event.name}: ${event.reason}`,
      silent: event.severity !== "threat",
    });
    n.on("click", () => {
      const w = BrowserWindow.getAllWindows()[0];
      if (w) {
        if (w.isMinimized()) w.restore();
        w.focus();
        w.webContents.send("capture:navigate", "protect-watch");
      }
    });
    n.show();
  }
  log.info("watch", { kind: event.kind, severity: event.severity, path: event.path });
}

// One file, judged with the same engine as a scan: rules, signature, hash lists, feeds and YARA.
async function check(file, { autostart = null } = {}) {
  let st;
  try {
    st = fs.statSync(file);
  } catch {
    return null;
  }
  if (!st.isFile() || engine.notLocal(st)) return null;
  const name = path.basename(file);
  if (!autostart && !engine.isCandidate(name, file)) return null;
  const facts = await engine.examine(file, { size: st.size, mtime: st.mtimeMs });
  let signer = null;
  if (facts.kind === "pe") signer = (await engine.checkSignatures([file]).catch(() => new Map())).get(file.toLowerCase()) ?? null;
  const verdict = engine.judge(facts, { signer, autostart });
  const detections = [];
  const blocklist = engine.loadBlocklist();
  const intel = engine.loadIntel();
  if (facts.sha256 && (blocklist.has(facts.sha256) || (facts.trimmedSha256 && blocklist.has(facts.trimmedSha256)))) detections.push(blocklist.get(facts.sha256) ?? blocklist.get(facts.trimmedSha256));
  if (facts.sha256 && intel.hashes.has(facts.sha256)) detections.push("A recent malware sample (MalwareBazaar feed)");
  const from = facts.zone?.url ? engine.hostsIn(facts.zone.url)[0] : null;
  if (from && intel.hosts.has(from)) detections.push(`Downloaded from a known malware site (${from})`);
  const bad = (facts.hosts ?? []).find((h) => intel.hosts.has(h));
  if (bad) detections.push(`Points to a known malware site (${bad})`);
  if (engine.yaraStatus().ready) {
    for (const h of await engine.scanYara([file]).catch(() => [])) {
      if (h.score === null || h.score >= 75) detections.push(`YARA: ${h.rule.replace(/_/g, " ")}`);
    }
  }
  const severity = detections.length ? "threat" : verdict.level;
  const reason = detections[0] ?? verdict.findings.find((f) => f.counted)?.label ?? "Nothing unusual";
  return { severity, reason, sha256: facts.sha256, size: st.size, name };
}

function schedule(file) {
  clearTimeout(timers.get(file));
  timers.set(
    file,
    setTimeout(async () => {
      timers.delete(file);
      try {
        const r = await check(file);
        if (r && (r.severity === "threat" || r.severity === "suspicious")) emit({ id: nextId++, time: new Date().toISOString(), kind: "file", path: file, ...r, status: "found" });
      } catch (err) {
        log.warn("watch check failed", file, err.message);
      }
    }, SETTLE_MS),
  );
}

const keyOf = (e) => `${e.source}|${e.location}|${e.name}|${e.command}`.toLowerCase();

async function checkStartup() {
  try {
    const { entries } = await engine.listAutostart();
    let baseline = null;
    try {
      baseline = new Set(JSON.parse(fs.readFileSync(BASELINE_FILE, "utf8")));
    } catch {
      // first run: everything present now is the baseline
    }
    const keys = entries.map(keyOf);
    if (baseline) {
      for (const e of entries.filter((x) => !baseline.has(keyOf(x)))) {
        const r = e.target && !e.missing ? await check(e.target, { autostart: e }) : null;
        const severity = r?.severity === "threat" || r?.severity === "suspicious" ? r.severity : "notice";
        emit({
          id: nextId++,
          time: new Date().toISOString(),
          kind: "startup",
          path: e.target ?? e.command,
          name: e.name,
          severity,
          reason: r && r.severity !== "clean" ? r.reason : `Added as a ${e.source === "task" ? "scheduled task" : e.source === "service" ? "service" : e.source === "startup-folder" ? "Startup folder item" : "Run key"}`,
          sha256: r?.sha256 ?? null,
          size: r?.size ?? 0,
          status: "found",
        });
      }
    }
    fs.writeFileSync(BASELINE_FILE, JSON.stringify(keys), "utf8");
  } catch (err) {
    log.warn("startup check failed", err.message);
  }
}

export function startWatch() {
  stopWatch();
  const startup = path.join(app.getPath("appData"), "Microsoft", "Windows", "Start Menu", "Programs", "Startup");
  for (const dir of [app.getPath("downloads"), app.getPath("desktop"), startup]) {
    if (!fs.existsSync(dir)) continue;
    try {
      const w = fs.watch(dir, { recursive: dir !== startup }, (type, filename) => {
        if (!filename) return;
        const file = path.join(dir, filename.toString());
        if (/\.(crdownload|part|partial|tmp|download)$/i.test(file) || /[\\/]~\$/.test(file)) return;
        schedule(file);
      });
      w.on("error", (err) => log.warn("watch error", dir, err.message));
      watchers.push(w);
    } catch (err) {
      log.warn("cannot watch", dir, err.message);
    }
  }
  checkStartup();
  startupTimer = setInterval(checkStartup, STARTUP_EVERY);
  log.info("watch mode on", { folders: watchers.length });
}

export function stopWatch() {
  for (const w of watchers) w.close();
  watchers = [];
  for (const t of timers.values()) clearTimeout(t);
  timers = new Map();
  clearInterval(startupTimer);
  startupTimer = null;
}

export function markEvent(id, status) {
  events = events.map((e) => (e.id === id ? { ...e, status } : e));
  saveEvents();
  return events;
}
