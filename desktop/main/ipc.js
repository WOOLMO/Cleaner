import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import * as engine from "./engine.js";
import { effectiveSettings, writeSettings } from "./settings.js";
import { getKey, saveKey, clearKey, keyStatus } from "./secrets.js";
import { log } from "./log.js";

const LAST_SCAN = path.join(engine.DATA_DIR, "last-scan.json");
const LAST_MAP = path.join(engine.DATA_DIR, "last-map.json");
const ENGINE_VERSION = (() => {
  try {
    return JSON.parse(fs.readFileSync(new URL("../core/engine-package.json", import.meta.url), "utf8")).version;
  } catch {
    return "unknown";
  }
})();

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
};
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value), "utf8");
};

let lastScan = readJson(LAST_SCAN);
let lastMap = readJson(LAST_MAP);
let mapTree = null; // sizes and children of the last map, kept in memory for drill-down
let scanJob = null;
let mapJob = null;
let organizing = null; // the last organize plan; the window applies it by file id, never by path
let graphRoot = null; // the folder graph only reads inside the folder it was opened on
let lastThreat = engine.readThreatScan();
let protectJob = null;
let networkJob = null;

// ---- validation: the window is treated as untrusted input ----
const fail = (message) => {
  throw new Error(message);
};
const asString = (v, name, max = 4096) => (typeof v === "string" && v.length > 0 && v.length <= max ? v : fail(`invalid ${name}`));
const asFolder = (v) => {
  const p = path.resolve(asString(v, "folder"));
  if (!path.isAbsolute(p) || !fs.existsSync(p) || !fs.statSync(p).isDirectory()) fail(`folder not found: ${p}`);
  return p;
};

function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return await fn(event, ...args);
    } catch (err) {
      log.error(`${channel} failed`, err);
      throw err;
    }
  });
}

// Progress events are sent at most every 80 ms; milestone events always go through.
function emitter(win, channel) {
  let last = 0;
  return (ev) => {
    if (win.isDestroyed()) return;
    const progress = ev.type === "walk" || ev.type === "hash" || ev.type === "inspect" || ev.type === "map";
    const now = Date.now();
    if (progress && now - last < 80) return;
    last = now;
    win.webContents.send(channel, ev);
  };
}

function drives() {
  const out = [];
  for (const letter of "CDEFGHIJKLMNOPQRSTUVWXYZ") {
    const root = `${letter}:\\`;
    try {
      const s = fs.statfsSync(root);
      if (s.blocks > 0) out.push({ root, letter, total: s.blocks * s.bsize, free: s.bavail * s.bsize });
    } catch {
      // no such drive
    }
  }
  return out;
}

function saveDb() {
  if (!lastScan) return;
  engine.writeDb(engine.DEFAULTS.db, engine.makeHeader({ roots: lastScan.roots, model: lastScan.classifiedBy }), lastScan.entries);
  writeJson(LAST_SCAN, lastScan);
}

const csvCell = (v) => {
  const s = String(v ?? "");
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function reportHtml(scan) {
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const fmt = (b) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(2)} GB` : b >= 1024 ** 2 ? `${(b / 1024 ** 2).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`);
  const sum = (list) => list.reduce((s, e) => s + e.size, 0);
  const safe = scan.entries.filter((e) => e.verdict === "remove");
  const yours = scan.entries.filter((e) => e.verdict === "review");
  const rows = scan.entries.map((e) => `<tr><td class="n">${e.id}</td><td>${esc(e.verdict === "remove" ? "Safe" : "Your call")}</td><td class="n">${fmt(e.size)}</td><td>${esc(e.category)}</td><td class="p">${esc(e.path)}</td><td>${esc(e.reason)}</td><td>${esc(e.status)}</td></tr>`).join("");
  return `<!doctype html><meta charset="utf-8"><title>Cleaner report</title><style>
body{font:13px/1.5 "Segoe UI",system-ui,sans-serif;color:#14201a;margin:40px;max-width:1200px}h1{font-size:22px;margin:0 0 4px}
.m{color:#5b6a62;margin:0 0 24px}.k{display:flex;gap:16px;margin:0 0 24px}.k div{border:1px solid #dde5df;border-radius:8px;padding:12px 16px;min-width:160px}
.k b{display:block;font-size:20px}table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #e7ede9;vertical-align:top}
th{font-weight:600;color:#5b6a62}.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}.p{font-family:Consolas,monospace;font-size:12px;word-break:break-all}</style>
<h1>Cleaner report</h1><p class="m">Scanned ${esc(scan.roots.join(", "))} on ${new Date(scan.finishedAt ?? Date.now()).toLocaleString()} by ${esc(os.userInfo().username)} on ${esc(os.hostname())}. ${scan.stats.files.toLocaleString()} files, ${fmt(scan.stats.bytes)}. Classified by ${esc(scan.classifiedBy)}.</p>
<div class="k"><div>Safe to remove<b>${fmt(sum(safe))}</b>${safe.length} items</div><div>Your call<b>${fmt(sum(yours))}</b>${yours.length} items</div><div>Kept<b>${scan.leftOut}</b>looked important</div></div>
<table><thead><tr><th class="n">#</th><th>Verdict</th><th class="n">Size</th><th>Category</th><th>Path</th><th>Reason</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>`;
}

export function registerIpc() {
  handle("app:info", () => ({
    version: app.getVersion(),
    engineVersion: ENGINE_VERSION,
    electron: process.versions.electron,
    dataDir: engine.DATA_DIR,
    auditFile: engine.AUDIT_FILE,
    policyFile: engine.POLICY_FILE,
    logFile: log.file,
    user: os.userInfo().username,
    machine: os.hostname(),
    home: os.homedir(),
  }));

  handle("system:drives", () => drives());

  handle("system:pickFolders", async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const r = await dialog.showOpenDialog(win, { title: "Choose folders to scan", properties: ["openDirectory", "multiSelections"] });
    return r.canceled ? [] : r.filePaths;
  });

  handle("system:reveal", (event, target) => {
    const p = path.resolve(asString(target, "path"));
    if (fs.existsSync(p)) shell.showItemInFolder(p);
    else if (fs.existsSync(path.dirname(p))) shell.openPath(path.dirname(p));
    return true;
  });

  handle("system:openExternal", (event, url) => {
    // Only the project page and Google AI Studio, never arbitrary URLs.
    if (/^https:\/\/(github\.com\/WOOLMO\/Cleaner|aistudio\.google\.com\/apikey|auth\.abuse\.ch\/?$|www\.virustotal\.com\/gui\/(my-apikey|file\/[a-f0-9]{64})$)/.test(asString(url, "url"))) shell.openExternal(url);
    return true;
  });

  handle("system:openPath", (event, which) => {
    const targets = { data: engine.DATA_DIR, logs: path.dirname(log.file) };
    if (targets[which]) shell.openPath(targets[which]);
    return true;
  });

  // ---- settings ----
  const settingsView = () => ({ ...effectiveSettings(), key: keyStatus() });
  handle("settings:get", () => settingsView());
  handle("settings:set", (event, patch) => {
    const { changed } = writeSettings(patch);
    if (changed.length) engine.audit("settings", { app: "desktop", changed });
    return settingsView();
  });
  handle("key:set", async (event, key) => {
    const value = asString(key, "key", 300).trim();
    const check = await engine.Gemini.checkKey(value);
    if (!check.ok) return { ok: false, message: check.message };
    saveKey(value);
    engine.audit("settings", { app: "desktop", changed: ["geminiKey"] });
    return { ok: true, ...settingsView() };
  });
  handle("key:clear", () => {
    clearKey();
    engine.audit("settings", { app: "desktop", changed: ["geminiKey removed"] });
    return settingsView();
  });

  // ---- scan ----
  handle("scan:last", () => lastScan);
  handle("scan:cancel", () => {
    scanJob?.abort();
    return true;
  });
  handle("scan:start", async (event, request) => {
    if (scanJob) fail("a scan is already running");
    const roots = (Array.isArray(request?.roots) ? request.roots : [os.homedir()]).slice(0, 20).map(asFolder);
    if (!roots.length) fail("choose at least one folder");
    const { settings, policy } = effectiveSettings();
    const { key } = getKey();
    const useAi = settings.aiEnabled && Boolean(key) && request?.ai !== false;
    const win = BrowserWindow.fromWebContents(event.sender);
    const controller = new AbortController();
    scanJob = controller;
    log.info("scan started", { roots, ai: useAi });
    try {
      const result = await engine.runScanPipeline({
        roots,
        ai: useAi ? { apiKey: key, models: engine.DEFAULTS.models } : null,
        noContent: !settings.previews,
        maxAi: settings.maxAi,
        largeMB: settings.largeMB,
        exclude: settings.exclude.map((p) => path.resolve(p).toLowerCase()),
        excludeTest: policy.managed ? (p) => engine.isExcludedByPolicy(policy, p) : null,
        signal: controller.signal,
        onEvent: emitter(win, "scan:event"),
      });
      lastScan = { ...result, finishedAt: Date.now() };
      saveDb();
      engine.audit("scan", { app: "desktop", roots, files: result.stats.files, bytes: result.stats.bytes, found: result.entries.length, classifiedBy: result.classifiedBy });
      log.info("scan finished", { files: result.stats.files, found: result.entries.length, ms: result.durationMs });
      return { ok: true, scan: lastScan };
    } catch (err) {
      if (controller.signal.aborted) return { ok: false, cancelled: true };
      log.error("scan failed", err);
      return { ok: false, error: err.message };
    } finally {
      scanJob = null;
    }
  });

  // Items are referenced by id from the last scan; the window never hands over raw paths to delete.
  handle("items:act", async (event, request) => {
    if (!lastScan) fail("there are no scan results");
    const action = request?.action;
    if (action !== "hold" && action !== "delete") fail("invalid action");
    const { policy, allowPermanentDelete } = effectiveSettings();
    if (action === "delete" && !allowPermanentDelete) fail("your organization requires the holding area instead of permanent deletion");
    const ids = new Set((Array.isArray(request.ids) ? request.ids : []).filter(Number.isInteger));
    const chosen = lastScan.entries.filter((e) => ids.has(e.id) && e.status === "pending");
    const allowed = chosen.filter((e) => engine.isSafeToRemove(e.path) && !(policy.managed && engine.isExcludedByPolicy(policy, e.path)));
    const blocked = chosen.length - allowed.length;
    if (!allowed.length) return { ok: true, done: 0, failed: 0, blocked, freed: 0, entries: lastScan.entries };

    const win = BrowserWindow.fromWebContents(event.sender);
    const before = engine.freeBytes(allowed[0].path);
    if (action === "hold") {
      engine.holdItems(allowed);
    } else {
      for (const [i, e] of allowed.entries()) {
        e.status = engine.removePermanently(e.path) ? "removed" : "failed";
        if (!win.isDestroyed()) win.webContents.send("items:progress", { done: i + 1, total: allowed.length });
        await new Promise((r) => setImmediate(r)); // keep the app responsive during long deletes
      }
    }
    const after = engine.freeBytes(allowed[0].path);
    saveDb();
    engine.audit(action, { app: "desktop", items: allowed });
    const done = allowed.filter((e) => e.status === (action === "hold" ? "held" : "removed")).length;
    return {
      ok: true,
      done,
      failed: allowed.length - done,
      blocked,
      freed: before !== null && after !== null ? Math.max(0, after - before) : 0,
      entries: lastScan.entries,
    };
  });

  handle("items:script", () => {
    if (!lastScan) fail("there are no scan results");
    const files = engine.writeRemovalScript(lastScan.entries, { dir: engine.desktopDir(), roots: lastScan.roots });
    engine.audit("export", { app: "desktop", kind: "removal-script", file: files.ps1 });
    shell.showItemInFolder(files.ps1);
    return files;
  });

  handle("report:export", async (event, format) => {
    if (!lastScan) fail("there are no scan results");
    if (!["csv", "json", "html"].includes(format)) fail("invalid format");
    const win = BrowserWindow.fromWebContents(event.sender);
    const stamp = new Date().toISOString().slice(0, 10);
    const r = await dialog.showSaveDialog(win, {
      title: "Export report",
      defaultPath: path.join(app.getPath("documents"), `cleaner-report-${stamp}.${format}`),
      filters: [{ name: format.toUpperCase(), extensions: [format] }],
    });
    if (r.canceled || !r.filePath) return { ok: false };
    let body;
    if (format === "json") {
      body = JSON.stringify({ generated: new Date().toISOString(), user: os.userInfo().username, machine: os.hostname(), ...lastScan }, null, 2);
    } else if (format === "csv") {
      const head = ["id", "verdict", "status", "size_bytes", "category", "path", "reason", "confidence"];
      body = "﻿" + [head.join(","), ...lastScan.entries.map((e) => [e.id, e.verdict, e.status, e.size, e.category, e.path, e.reason, e.confidence].map(csvCell).join(","))].join("\r\n");
    } else {
      body = reportHtml(lastScan);
    }
    fs.writeFileSync(r.filePath, body, "utf8");
    engine.audit("export", { app: "desktop", kind: `report-${format}`, file: r.filePath });
    shell.showItemInFolder(r.filePath);
    return { ok: true, file: r.filePath };
  });

  // ---- space map ----
  handle("map:last", () => lastMap);
  handle("map:cancel", () => {
    mapJob?.abort();
    return true;
  });
  handle("map:start", async (event, request) => {
    if (mapJob) fail("a map is already running");
    const root = asFolder(request?.root ?? path.parse(os.homedir()).root);
    const win = BrowserWindow.fromWebContents(event.sender);
    const emit = emitter(win, "map:event");
    const controller = new AbortController();
    mapJob = controller;
    const started = Date.now();
    try {
      const result = await engine.spaceMap(root, { signal: controller.signal, onProgress: (p) => emit({ type: "map", ...p }) });
      mapTree = { root: result.root, sizes: result.sizes, kids: result.kids, stats: result.stats };
      const minBytes = Math.min(512 * 1024 ** 2, Math.max(1024 ** 2, result.stats.bytes * 0.02));
      const units = engine.pickUnits(result, { minBytes, limit: 15 });
      let disk = null;
      try {
        const s = fs.statfsSync(path.parse(root).root);
        disk = { total: s.blocks * s.bsize, free: s.bavail * s.bsize };
      } catch {
        // skip
      }
      lastMap = { root, stats: result.stats, units, disk, explained: {}, finishedAt: Date.now(), durationMs: Date.now() - started };
      writeJson(LAST_MAP, lastMap);
      engine.audit("map", { app: "desktop", root, files: result.stats.files, bytes: result.stats.bytes });

      // Explanations arrive a moment later, so the map shows right away.
      const { settings } = effectiveSettings();
      const { key } = getKey();
      if (settings.aiEnabled && key && units.length) {
        const gemini = new engine.Gemini({ apiKey: key, models: engine.DEFAULTS.models });
        engine.explainFolders(units, { gemini }).then(({ results, error }) => {
          if (!lastMap || lastMap.root !== root) return;
          lastMap.explained = Object.fromEntries([...results].map(([id, r]) => [units[id - 1]?.path, r]).filter(([p]) => p));
          lastMap.explainError = error?.message ?? null;
          lastMap.explainedBy = [...gemini.used].join(", ") || null;
          writeJson(LAST_MAP, lastMap);
          if (!win.isDestroyed()) win.webContents.send("map:explained", lastMap);
        });
      }
      return { ok: true, map: lastMap, aiPending: Boolean(settings.aiEnabled && key && units.length) };
    } catch (err) {
      if (controller.signal.aborted) return { ok: false, cancelled: true };
      return { ok: false, error: err.message };
    } finally {
      mapJob = null;
    }
  });

  handle("map:children", (event, target) => {
    if (!mapTree) return null;
    const dir = asString(target, "path");
    const own = mapTree.sizes.get(dir);
    if (own === undefined) return null;
    const kids = (mapTree.kids.get(dir) ?? []).map((p) => ({ path: p, name: path.basename(p), size: mapTree.sizes.get(p) ?? 0 }));
    kids.sort((a, b) => b.size - a.size);
    const loose = own - kids.reduce((s, k) => s + k.size, 0);
    return { path: dir, size: own, children: kids, loose: Math.max(0, loose) };
  });

  // ---- holding area ----
  handle("hold:list", () => engine.listHeld());
  const pickHeld = (paths) => {
    const wanted = new Set((Array.isArray(paths) ? paths : []).filter((p) => typeof p === "string"));
    return engine.listHeld().filter((h) => wanted.has(h.held));
  };
  handle("hold:restore", (event, paths) => {
    const items = pickHeld(paths);
    const r = engine.restoreHeld(items);
    const result = (h) => (r.restored.includes(h) ? "restored" : r.conflicts.includes(h) ? "conflict" : "failed");
    engine.audit("restore", { app: "desktop", items: items.map((h) => ({ path: h.original, size: h.size, result: result(h) })) });
    if (lastScan) {
      const back = new Set(r.restored.map((h) => h.original.toLowerCase()));
      for (const e of lastScan.entries) if (e.status === "held" && back.has(e.path.toLowerCase())) e.status = "pending";
      saveDb();
    }
    return { restored: r.restored.length, conflicts: r.conflicts.length, failed: r.failed.length };
  });
  handle("hold:purge", (event, paths) => {
    const items = pickHeld(paths);
    const before = engine.freeBytes(engine.HOLD_DIR);
    const r = engine.purgeHeld(items);
    const after = engine.freeBytes(engine.HOLD_DIR);
    engine.audit("purge", { app: "desktop", items: items.map((h) => ({ path: h.original, size: h.size, result: r.purged.includes(h) ? "purged" : "failed" })) });
    if (lastScan) {
      const gone = new Set(r.purged.map((h) => h.original.toLowerCase()));
      for (const e of lastScan.entries) if (e.status === "held" && gone.has(e.path.toLowerCase())) e.status = "removed";
      saveDb();
    }
    return { purged: r.purged.length, failed: r.failed.length, freed: before !== null && after !== null ? Math.max(0, after - before) : 0 };
  });

  // ---- organize ----
  const LOCALE = () => app.getPreferredSystemLanguages?.()[0] ?? app.getLocale();
  const runView = (j) => ({
    id: j.id,
    root: j.root,
    time: j.time,
    moved: j.moves.length,
    bytes: j.moves.reduce((s, m) => s + (m.size ?? 0), 0),
    createdFolders: j.createdFolders.length,
    folders: [...new Set(j.moves.map((m) => path.basename(path.dirname(m.to))))],
    failed: j.failed,
    undoneAt: j.undoneAt ?? null,
    restored: j.undo?.restored ?? null,
  });

  handle("system:pickFolder", async (event, title) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const r = await dialog.showOpenDialog(win, { title: typeof title === "string" ? title.slice(0, 80) : "Choose a folder", properties: ["openDirectory"] });
    return r.canceled ? null : r.filePaths[0] ?? null;
  });

  handle("organize:places", () => {
    const loose = (dir) => {
      try {
        return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile() && !e.name.startsWith(".") && !/\.(lnk|url|ini)$/i.test(e.name)).length;
      } catch {
        return 0;
      }
    };
    return ["desktop", "downloads", "documents", "pictures"]
      .map((which) => {
        const p = app.getPath(which);
        return { id: which, path: p, name: path.basename(p), loose: loose(p) };
      })
      .filter((x) => fs.existsSync(x.path) && !engine.organizeBlocked(x.path));
  });

  handle("organize:plan", async (event, request) => {
    const root = asFolder(request?.root);
    const blocked = engine.organizeBlocked(root);
    if (blocked) return { ok: false, error: blocked };
    const analysis = engine.analyzeFolder(root, { systemLocale: LOCALE() });
    let plan = engine.rulePlan(analysis);
    let planner = "local rules";
    let aiError = null;
    const { settings } = effectiveSettings();
    const { key } = getKey();
    if (settings.aiEnabled && key && request?.ai !== false && analysis.files.length) {
      const gemini = new engine.Gemini({ apiKey: key, models: engine.DEFAULTS.models });
      try {
        plan = await engine.aiPlan(analysis, plan, { gemini });
        planner = [...gemini.used].join(", ") || "gemini";
      } catch (err) {
        aiError = err.message;
      }
    }
    organizing = { analysis, plan };
    log.info("organize planned", { root, files: analysis.files.length, moves: plan.moves.length, planner });
    return {
      ok: true,
      plan: {
        root,
        style: { ...analysis.style, languageName: engine.LANGUAGE_NAMES[analysis.style.language] },
        folders: analysis.folders.map((f) => ({ name: f.name, dominant: f.profile.dominant, files: f.profile.files, project: f.profile.project })),
        files: analysis.files.map(({ id, name, size, mtime, ext, category }) => ({ id, name, size, mtime, ext, category })),
        skipped: analysis.skipped.map(({ name, size, reason }) => ({ name, size, reason })),
        moves: plan.moves,
        stay: plan.stay.map(({ id, reason }) => ({ id, reason })),
        planner,
        aiError,
      },
    };
  });

  handle("organize:apply", (event, request) => {
    if (!organizing) fail("plan the folder again first");
    const known = new Set(organizing.analysis.files.map((f) => f.id));
    const moves = (Array.isArray(request?.moves) ? request.moves : [])
      .filter((m) => m && Number.isInteger(m.id) && known.has(m.id))
      .map((m) => ({ id: m.id, folder: engine.cleanFolderName(m.folder) }))
      .filter((m) => m.folder);
    if (!moves.length) fail("nothing to move");
    const { analysis } = organizing;
    if (engine.organizeBlocked(analysis.root)) fail("this folder can't be organized");
    const journal = engine.applyPlan(analysis, moves);
    organizing = null;
    engine.audit("organize", { app: "desktop", root: analysis.root, run: journal.id, items: journal.moves.map((m) => ({ path: m.from, to: m.to, size: m.size })) });
    log.info("organized", { root: analysis.root, moved: journal.moves.length, failed: journal.failed.length });
    return { ok: true, run: runView(journal) };
  });

  handle("organize:history", () => engine.listJournals().slice(0, 50).map(runView));

  handle("organize:undo", (event, id) => {
    const runId = asString(id, "run", 80);
    const r = engine.undoOrganize(runId);
    engine.audit("organize-undo", { app: "desktop", root: r.journal.root, run: runId, items: r.journal.moves.map((m) => ({ path: m.from, size: m.size })) });
    return { restored: r.restored, skipped: r.skipped.length, run: runView(r.journal) };
  });

  // ---- folder graph ----
  const scanFlags = () => (lastScan ? new Map(lastScan.entries.filter((e) => e.status === "pending").map((e) => [e.path.toLowerCase(), e.verdict])) : null);
  handle("graph:load", (event, request) => {
    const root = asFolder(request?.root ?? os.homedir());
    graphRoot = root;
    const tree = engine.readGraph(root, { flags: scanFlags() });
    return { ok: true, tree };
  });
  handle("graph:expand", (event, target) => {
    const dir = path.resolve(asString(target, "path"));
    if (!graphRoot || !engine.isInside(graphRoot, dir)) fail("outside the folder in the graph");
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return { children: [], error: "folder not found" };
    return engine.readLevel(dir, { flags: scanFlags() });
  });

  // The full network: every folder under a root, sized with the space map walk (reused when the
  // space map of that root is still in memory) and trimmed to a drawable budget.
  handle("graph:network", async (event, request) => {
    if (networkJob) fail("the network is already being built");
    const root = asFolder(request?.root ?? os.homedir());
    let map = mapTree && mapTree.root.toLowerCase() === root.toLowerCase() ? mapTree : null;
    if (!map) {
      const win = BrowserWindow.fromWebContents(event.sender);
      const emit = emitter(win, "graph:networkEvent");
      const controller = new AbortController();
      networkJob = controller;
      try {
        const result = await engine.spaceMap(root, { signal: controller.signal, onProgress: (p) => emit({ type: "map", ...p }) });
        mapTree = { root: result.root, sizes: result.sizes, kids: result.kids, stats: result.stats };
        map = mapTree;
      } catch (err) {
        if (controller.signal.aborted) return { ok: false, cancelled: true };
        return { ok: false, error: err.message };
      } finally {
        networkJob = null;
      }
    }
    graphRoot = root;
    // The web graph stays smooth up to a few thousand folders; the biggest branches get the budget.
    const network = engine.buildNetwork(map, { budget: Math.max(300, Math.min(5000, Number(request?.budget) || 2500)) });
    log.info("folder network built", { root, nodes: network.nodes.length });
    return { ok: true, network };
  });
  handle("graph:networkCancel", () => {
    networkJob?.abort();
    return true;
  });

  // ---- protection ----
  let defenderCache = null;
  const defender = async () => {
    if (!defenderCache || Date.now() - defenderCache.at > 5 * 60_000) defenderCache = { at: Date.now(), value: await engine.defenderStatus() };
    return defenderCache.value;
  };
  const protectStatus = async () => {
    const { policy } = effectiveSettings();
    return {
      defender: await defender(),
      keys: { malwareBazaar: keyStatus("malwareBazaar"), virusTotal: keyStatus("virusTotal") },
      knownHashes: engine.loadBlocklist(policy.blocklistFile ? [policy.blocklistFile] : []).size,
      quarantined: engine.listQuarantine().length,
    };
  };
  handle("protect:status", () => protectStatus());
  handle("protect:last", () => lastThreat);
  handle("protect:cancel", () => {
    protectJob?.abort();
    return true;
  });
  handle("protect:start", async (event, request) => {
    if (protectJob) fail("a threat scan is already running");
    const mode = ["quick", "full", "custom"].includes(request?.mode) ? request.mode : "quick";
    const roots = mode === "custom" ? (Array.isArray(request?.roots) ? request.roots : []).slice(0, 20).map(asFolder) : [];
    if (mode === "custom" && !roots.length) fail("choose at least one folder");
    const { settings, policy } = effectiveSettings();
    const gemini = getKey("gemini").key;
    // A policy that turns Gemini off also keeps file hashes on the machine.
    const online = settings.aiEnabled;
    const win = BrowserWindow.fromWebContents(event.sender);
    const emit = emitter(win, "protect:event");
    const controller = new AbortController();
    protectJob = controller;
    log.info("threat scan started", { mode, roots });
    try {
      const result = await engine.runThreatScan({
        mode,
        roots,
        desktop: app.getPath("desktop"),
        ai: settings.aiEnabled && gemini ? { apiKey: gemini, models: engine.DEFAULTS.models } : null,
        keys: online ? { malwareBazaar: getKey("malwareBazaar").key, virusTotal: getKey("virusTotal").key } : {},
        blocklists: policy.blocklistFile ? [policy.blocklistFile] : [],
        signal: controller.signal,
        onEvent: emit,
      });
      lastThreat = { ...result, finishedAt: Date.now() };
      engine.saveThreatScan(lastThreat);
      engine.audit("threat-scan", { app: "desktop", mode, roots: result.roots, files: result.stats.inspected, threats: result.stats.threats, suspicious: result.stats.suspicious });
      log.info("threat scan finished", { inspected: result.stats.inspected, threats: result.stats.threats, suspicious: result.stats.suspicious, ms: result.durationMs });
      return { ok: true, scan: lastThreat };
    } catch (err) {
      if (controller.signal.aborted) return { ok: false, cancelled: true };
      log.error("threat scan failed", err);
      return { ok: false, error: err.message };
    } finally {
      protectJob = null;
    }
  });

  // Files are quarantined by their number in the last threat scan, never by a path from the window.
  const pickResults = (ids) => {
    if (!lastThreat) fail("there is no threat scan");
    const wanted = new Set((Array.isArray(ids) ? ids : []).filter(Number.isInteger));
    return lastThreat.results.filter((r) => wanted.has(r.id));
  };
  handle("protect:quarantine", (event, ids) => {
    const picked = pickResults(ids).filter((r) => r.status === "found");
    const done = [];
    const failed = [];
    for (const r of picked) {
      try {
        engine.quarantineFile(r.path, { reason: r.detections[0]?.name ?? r.findings.find((f) => f.counted)?.label ?? null, sha256: r.sha256, severity: r.severity });
        r.status = "quarantined";
        done.push(r);
      } catch (err) {
        failed.push({ path: r.path, reason: err.message });
      }
    }
    engine.saveThreatScan(lastThreat);
    if (done.length) engine.audit("quarantine", { app: "desktop", items: done.map((r) => ({ path: r.path, size: r.size, result: r.severity })) });
    return { done: done.length, failed, scan: lastThreat };
  });
  handle("protect:trust", (event, id) => {
    const [r] = pickResults([id]);
    if (!r?.sha256) fail("that file has no fingerprint to trust");
    engine.trustHash(r.sha256, { path: r.path, name: r.name });
    r.status = "trusted";
    r.trusted = true;
    engine.saveThreatScan(lastThreat);
    engine.audit("settings", { app: "desktop", changed: [`trusted ${r.name}`] });
    return lastThreat;
  });
  handle("protect:lookup", async (event, id) => {
    const [r] = pickResults([id]);
    if (!r?.sha256) fail("that file has no fingerprint to look up");
    const { key } = getKey("virusTotal");
    if (!key || !effectiveSettings().settings.aiEnabled) {
      shell.openExternal(engine.virusTotalPage(r.sha256));
      return { opened: true };
    }
    const result = await engine.virusTotal(r.sha256, key);
    r.reputation = [...(r.reputation ?? []).filter((x) => x.source !== "virustotal"), result];
    engine.saveThreatScan(lastThreat);
    return { opened: false, result, scan: lastThreat };
  });

  handle("quarantine:list", () => engine.listQuarantine());
  const knownQuarantine = (id) => {
    const q = engine.listQuarantine().find((x) => x.id === id);
    if (!q) fail("that file is not in quarantine");
    return q;
  };
  handle("quarantine:restore", (event, id) => {
    const q = knownQuarantine(asString(id, "id", 80));
    engine.restoreQuarantined(q.id);
    engine.audit("quarantine-restore", { app: "desktop", items: [{ path: q.original, size: q.size, result: "restored" }] });
    if (lastThreat) {
      for (const r of lastThreat.results) if (r.status === "quarantined" && r.path.toLowerCase() === q.original.toLowerCase()) r.status = "found";
      engine.saveThreatScan(lastThreat);
    }
    return engine.listQuarantine();
  });
  handle("quarantine:delete", (event, id) => {
    const q = knownQuarantine(asString(id, "id", 80));
    engine.deleteQuarantined(q.id);
    engine.audit("quarantine-delete", { app: "desktop", items: [{ path: q.original, size: q.size, result: "deleted" }] });
    return engine.listQuarantine();
  });

  handle("keys:set", async (event, request) => {
    const name = request?.name;
    if (name !== "malwareBazaar" && name !== "virusTotal") fail("unknown service");
    const value = asString(request?.key, "key", 300).trim();
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(value)) return { ok: false, message: "That does not look like an API key." };
    saveKey(value, name);
    engine.audit("settings", { app: "desktop", changed: [`${name} key`] });
    return { ok: true, status: await protectStatus() };
  });
  handle("keys:clear", async (event, name) => {
    if (name !== "malwareBazaar" && name !== "virusTotal") fail("unknown service");
    clearKey(name);
    engine.audit("settings", { app: "desktop", changed: [`${name} key removed`] });
    return protectStatus();
  });

  // ---- activity ----
  handle("audit:list", (event, limit) => engine.readAudit({ limit: Number.isInteger(limit) ? Math.min(limit, 5000) : 500 }));
  handle("audit:export", async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const r = await dialog.showSaveDialog(win, {
      title: "Export activity log",
      defaultPath: path.join(app.getPath("documents"), `cleaner-activity-${new Date().toISOString().slice(0, 10)}.csv`),
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    if (r.canceled || !r.filePath) return { ok: false };
    const rows = engine.readAudit({ limit: 100_000 }).reverse();
    const head = ["time", "action", "app", "user", "machine", "count", "bytes", "detail"];
    const detail = (a) => a.roots?.join(" | ") ?? a.root ?? a.file ?? a.changed?.join(" | ") ?? "";
    const body = "﻿" + [head.join(","), ...rows.map((a) => [a.time, a.action, a.app, a.user, a.machine, a.count ?? "", a.bytes ?? "", detail(a)].map(csvCell).join(","))].join("\r\n");
    fs.writeFileSync(r.filePath, body, "utf8");
    shell.showItemInFolder(r.filePath);
    return { ok: true, file: r.filePath };
  });
}
