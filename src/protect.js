import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { walk, notLocal } from "./walk.js";
import { examine, judge, isCandidate, placeOf, PE_EXT } from "./threat-rules.js";
import { listAutostart, winlogonOdd } from "./autostart.js";
import { loadBlocklist, loadTrusted, checkSignatures, defenderStatus, defenderScan, malwareBazaar, virusTotal } from "./reputation.js";
import { runPowerShell } from "./powershell.js";
import { Gemini } from "./gemini.js";
import { DATA_DIR } from "./config.js";
import { updateIntel, loadIntel, intelStatus, hostsIn, hashLookup } from "./intel.js";
import { yaraStatus, scanYara } from "./yara.js";
import { snapshot, analyzeBehavior } from "./behavior.js";

// The threat scan: an on-demand second opinion next to the real-time antivirus.
// Severity: "threat" needs hard evidence (a known-bad hash, an antivirus engine, a malware database);
// rules and Gemini can only make something "suspicious" or a "notice", always with reasons.

export const LAST_THREAT_SCAN = path.join(DATA_DIR, "last-threat-scan.json");
const FILE_CACHE = path.join(DATA_DIR, "file-cache.json");

// Fingerprints and signatures of files already looked at, keyed by path; reused while size and date match.
function loadFileCache() {
  try {
    return new Map(Object.entries(JSON.parse(fs.readFileSync(FILE_CACHE, "utf8"))));
  } catch {
    return new Map();
  }
}
function saveFileCache(cache) {
  try {
    const entries = [...cache.entries()].slice(-80_000);
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE_CACHE, JSON.stringify(Object.fromEntries(entries)), "utf8");
  } catch {
    // a cache that cannot be written only costs speed next time
  }
}

export function saveThreatScan(result) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(LAST_THREAT_SCAN, JSON.stringify({ finishedAt: Date.now(), ...result }), "utf8");
}

export function readThreatScan() {
  try {
    return JSON.parse(fs.readFileSync(LAST_THREAT_SCAN, "utf8"));
  } catch {
    return null;
  }
}

const SKIP_DIRS = /^(\$recycle\.bin|system volume information|windowsapps|winsxs|servicing|installer)$/i;
const DEV_DIRS = new Set(["node_modules", ".git", "__pycache__", "site-packages", ".venv", "venv", ".cargo", ".rustup", ".gradle", ".m2", ".nuget", ".npm", ".pnpm-store", ".yarn", ".tox", ".mypy_cache", ".pytest_cache"]);
const MAX_CANDIDATES = 60_000;
const PROJECT_FILES = /^(package\.json|tsconfig\.json|pyproject\.toml|cargo\.toml|go\.mod|pom\.xml|build\.gradle|composer\.json|gemfile)$/i;
const SOURCE_EXT = /\.(js|jse|mjs|cjs|ts|tsx|jsx)$/i;
const CONCURRENCY = 8;

export function scanPlan(mode, { home = os.homedir(), desktop = null, roots = [], env = process.env } = {}) {
  const local = env.LOCALAPPDATA ?? path.join(home, "AppData", "Local");
  const roaming = env.APPDATA ?? path.join(home, "AppData", "Roaming");
  const programData = env.ProgramData ?? "C:\\ProgramData";
  const publicDir = env.PUBLIC ?? "C:\\Users\\Public";
  const startup = [path.join(roaming, "Microsoft", "Windows", "Start Menu", "Programs", "Startup"), path.join(programData, "Microsoft", "Windows", "Start Menu", "Programs", "StartUp")];
  let jobs;
  if (mode === "custom") jobs = roots.map((dir) => ({ dir, depth: 64 }));
  else if (mode === "full") jobs = [{ dir: home, depth: 64 }, { dir: programData, depth: 2 }, { dir: publicDir, depth: 6 }];
  else {
    jobs = [
      { dir: path.join(home, "Downloads"), depth: 4 },
      { dir: desktop ?? path.join(home, "Desktop"), depth: 3 },
      { dir: path.join(local, "Temp"), depth: 3 },
      { dir: roaming, depth: 2 },
      { dir: local, depth: 1 },
      { dir: programData, depth: 2 },
      { dir: publicDir, depth: 3 },
      ...startup.map((dir) => ({ dir, depth: 2 })),
    ];
  }
  const seen = new Set();
  return jobs.filter((j) => j.dir && fs.existsSync(j.dir) && !seen.has(j.dir.toLowerCase()) && seen.add(j.dir.toLowerCase()));
}

async function pool(items, size, fn, signal) {
  let next = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      signal?.throwIfAborted();
      const i = next++;
      await fn(items[i], i);
    }
  });
  await Promise.all(workers);
}

const AI_PROMPT = `You are a malware analyst reviewing files that a local scanner flagged on a Windows PC.
For each item you get its name, folder, size, digital signer, where it was downloaded from, what kind of file it is, and the scanner's findings.
Decide for each item:
- verdict: likely-benign (a known legitimate tool, game, installer or developer file), unclear, or likely-malicious.
- confidence: 0 to 1.
- reason: one plain sentence under 90 characters a non-expert understands.
Rules: you cannot see the file contents. Developer tools, game mods, cheats and security tools often look suspicious but are not malware; say so when the name and folder suggest it. Never call something likely-malicious from the name alone.`;

const AI_SCHEMA = {
  type: "OBJECT",
  properties: {
    results: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { id: { type: "INTEGER" }, verdict: { type: "STRING", enum: ["likely-benign", "unclear", "likely-malicious"] }, confidence: { type: "NUMBER" }, reason: { type: "STRING" } },
        required: ["id", "verdict", "confidence", "reason"],
      },
    },
  },
  required: ["results"],
};

const homeMasked = (p) => p.replace(new RegExp(os.homedir().replace(/[\\^$.*+?()[\]{}|]/g, "\\$&"), "i"), "%USERPROFILE%");

export async function runThreatScan({
  mode = "quick",
  roots = [],
  desktop = null,
  includeDev = false,
  ai = null, // { apiKey, models }
  keys = {}, // { malwareBazaar, virusTotal }
  blocklists = [],
  useDefender = true,
  autostart = true,
  online = true, // threat-intel updates and CIRCL hashlookup (hashes only)
  useIntel = true,
  useYara = true,
  behavior = true,
  signal,
  onEvent = () => {},
  run = runPowerShell,
  fetchImpl = globalThis.fetch,
} = {}) {
  const started = Date.now();
  const engines = { rules: true, hashList: true, defender: null, malwareBazaar: Boolean(keys.malwareBazaar), virusTotal: Boolean(keys.virusTotal), gemini: Boolean(ai), intel: null, yara: null, hashlookup: Boolean(online), behavior: Boolean(behavior) };
  const errors = [];
  const blocklist = loadBlocklist(blocklists);
  const trusted = loadTrusted();

  // 0. Open threat intelligence: refresh stale feeds (public lists, nothing about this PC is sent).
  let intel = null;
  if (useIntel) {
    if (online) {
      onEvent({ type: "phase", phase: "intel" });
      try {
        const report = await updateIntel({ fetchImpl, signal });
        for (const [name, r] of Object.entries(report)) if (!r.ok) errors.push(`${name} feed: ${r.error}`);
      } catch (err) {
        if (signal?.aborted) throw err;
        errors.push(`threat intel: ${err.message}`);
      }
    }
    intel = loadIntel();
    engines.intel = intelStatus();
  }

  // 1. What starts with Windows.
  onEvent({ type: "phase", phase: "autostart" });
  const defenderPromise = useDefender ? defenderStatus({ run }).catch(() => ({ available: false, reason: "Defender did not answer" })) : Promise.resolve({ available: false, reason: "turned off" });
  let startups = [];
  if (autostart) {
    try {
      const r = await listAutostart({ run, signal });
      startups = r.entries;
      if (r.error) errors.push(r.error);
    } catch (err) {
      if (signal?.aborted) throw err;
      errors.push(`startup list: ${err.message}`);
    }
  }
  onEvent({ type: "autostart", count: startups.length });

  // 2. Files worth a look.
  onEvent({ type: "phase", phase: "walk" });
  const jobs = scanPlan(mode, { roots, desktop });
  const candidates = new Map();
  let filesSeen = 0;
  let cloudOnly = 0;
  let lastEmit = 0;
  await walk(jobs, (job, listing) => {
    if (!listing) return null;
    filesSeen += listing.files.length;
    const project = job.project || listing.dirs.some((d) => d.name === ".git") || listing.files.some((f) => PROJECT_FILES.test(f.name));
    for (const f of listing.files) {
      if (candidates.size >= MAX_CANDIDATES) break;
      const why = isCandidate(f.name, f.path);
      if (!why) continue;
      // source files in a code project are the owner's own code, not something that landed there
      if (project && SOURCE_EXT.test(f.name)) continue;
      // online-only OneDrive files stay in the cloud: opening them would download them
      if (notLocal(f)) {
        cloudOnly++;
        continue;
      }
      candidates.set(f.path.toLowerCase(), { path: f.path, size: f.size, mtime: f.mtimeMs, why, autostart: null });
    }
    const now = Date.now();
    if (now - lastEmit > 120) {
      lastEmit = now;
      onEvent({ type: "walk", files: filesSeen, candidates: candidates.size, current: job.dir });
    }
    if (job.depth <= 0) return null;
    return listing.dirs
      .filter((d) => !SKIP_DIRS.test(d.name) && (includeDev || !DEV_DIRS.has(d.name.toLowerCase())))
      .map((d) => ({ dir: d.path, depth: job.depth - 1, project }));
  }, { signal });

  for (const s of startups) {
    if (!s.target || s.missing) continue;
    const key = s.target.toLowerCase();
    const known = candidates.get(key);
    if (known) known.autostart = s;
    else {
      try {
        const st = fs.statSync(s.target);
        if (st.isFile()) candidates.set(key, { path: s.target, size: st.size, mtime: st.mtimeMs, why: "autostart", autostart: s });
      } catch {
        // unreadable target: reported with the startup entry
      }
    }
  }
  onEvent({ type: "walked", files: filesSeen, candidates: candidates.size });

  // 3. Look inside each candidate.
  onEvent({ type: "phase", phase: "inspect" });
  const list = [...candidates.values()];
  const facts = new Array(list.length);
  let done = 0;
  const cache = loadFileCache();
  await pool(list, CONCURRENCY, async (c, i) => {
    const known = cache.get(c.path.toLowerCase());
    const fresh = known && known.size === c.size && known.mtime === c.mtime;
    facts[i] = await examine(c.path, { size: c.size, mtime: c.mtime, signal, sha256: fresh ? known.sha256 ?? undefined : undefined });
    done++;
    if (done % 25 === 0 || done === list.length) onEvent({ type: "inspect", done, total: list.length, current: c.path });
  }, signal);

  // 4. Digital signatures, for programs that need one to be trusted.
  onEvent({ type: "phase", phase: "signatures" });
  const pre = list.map((c, i) => judge(facts[i], { autostart: c.autostart }));
  const needSig = list
    .map((c, i) => ({ c, f: facts[i], p: pre[i] }))
    .filter(({ c, f, p }) => (f.kind === "pe" || ["msi", "ps1", "psm1"].includes(f.ext)) && (p.score >= 2 || c.autostart || c.why !== "risky" || isUserPlace(c.path)))
    .slice(0, 4000)
    .map(({ c }) => c.path);
  // signatures we already checked for this exact file (same size and date) are reused
  const signers = new Map();
  const toCheck = [];
  for (const p of needSig) {
    const c = candidates.get(p.toLowerCase());
    const known = cache.get(p.toLowerCase());
    if (known?.signer && known.size === c.size && known.mtime === c.mtime) signers.set(p.toLowerCase(), known.signer);
    else toCheck.push(p);
  }
  try {
    for (const [k, v] of await checkSignatures(toCheck, { run, signal })) signers.set(k, v);
  } catch (err) {
    if (signal?.aborted) throw err;
    errors.push(`signatures: ${err.message}`);
  }
  onEvent({ type: "signatures", checked: signers.size, reused: needSig.length - toCheck.length });
  list.forEach((c, i) => {
    const key = c.path.toLowerCase();
    // big files are not fingerprinted, but their signature (slow to check) is still worth remembering
    if (facts[i].sha256 || signers.has(key)) cache.set(key, { size: c.size, mtime: c.mtime, sha256: facts[i].sha256 ?? null, signer: signers.get(key) ?? cache.get(key)?.signer ?? null });
  });
  saveFileCache(cache);

  // 5. Verdicts from the rules, then hard evidence.
  const items = list.map((c, i) => {
    const f = facts[i];
    const signer = signers.get(c.path.toLowerCase()) ?? null;
    const verdict = judge(f, { signer, autostart: c.autostart });
    const detections = [];
    const listed = blocklist.get(f.sha256) ?? (f.trimmedSha256 ? blocklist.get(f.trimmedSha256) : undefined);
    if (listed) detections.push({ source: "hash", name: listed });
    if (intel) {
      if (f.sha256 && intel.hashes.has(f.sha256)) detections.push({ source: "malwarebazaar-feed", name: "A recent malware sample (MalwareBazaar feed)" });
      const driver = f.sha256 ? intel.drivers.get(f.sha256) : null;
      if (driver?.malicious) detections.push({ source: "loldrivers", name: `A known malicious driver (${driver.name})` });
      else if (driver) verdict.findings.push({ id: "vulnerable-driver", weight: 6, label: "A driver known to be abused to switch off security software (LOLDrivers)", detail: driver.name, counted: true });
      const from = f.zone?.url ? hostsIn(f.zone.url)[0] : null;
      if (from && intel.hosts.has(from)) detections.push({ source: "urlhaus", name: `Downloaded from a known malware site (${from})` });
      const bad = (f.hosts ?? []).find((h) => intel.hosts.has(h));
      if (bad) detections.push({ source: "urlhaus", name: `Points to a known malware site (${bad})` });
    }
    const it = { c, f, signer, ...verdict, detections, ai: null, reputation: [], adjust: 0 };
    rescore(it);
    return it;
  });

  const defender = await defenderPromise;
  engines.defender = defender.available;
  if (defender.available) {
    onEvent({ type: "phase", phase: "defender" });
    const targets = items.filter((it) => it.score >= 3 || (it.c.autostart && it.signer?.status !== "valid") || (it.f.kind === "pe" && isUserPlace(it.c.path))).slice(0, 150);
    try {
      const hits = await defenderScan(targets.map((t) => t.c.path), { signal, onProgress: (d, t) => onEvent({ type: "defender", done: d, total: t }) });
      for (const it of targets) {
        const name = hits.get(it.c.path.toLowerCase());
        if (name) it.detections.push({ source: "defender", name });
      }
    } catch (err) {
      if (signal?.aborted) throw err;
      errors.push(`defender: ${err.message}`);
    }
  }

  // 5b. YARA with the YARA Forge community rules, when the user installed them.
  const yara = useYara ? yaraStatus() : null;
  if (yara?.ready) {
    engines.yara = { rules: yara.rules?.count ?? null, release: yara.rules?.release ?? null };
    onEvent({ type: "phase", phase: "yara" });
    const targets = items.filter((it) => !it.f.cloudOnly && !it.f.error && it.f.size > 0 && it.f.size <= 64 * 1024 * 1024);
    try {
      const hits = await scanYara(targets.map((it) => it.c.path), { signal, onProgress: (done, total) => onEvent({ type: "yara", done, total }) });
      if (hits.skipped) errors.push(`yara: ${hits.skipped} files were not checked in time`);
      const byFile = new Map(items.map((it) => [it.c.path.toLowerCase(), it]));
      for (const h of hits) {
        const it = byFile.get(h.file.toLowerCase());
        if (!it) continue;
        const name = `${h.rule.replace(/_/g, " ")}${h.description ? `: ${h.description}` : ""}`;
        const signed = it.signer?.status === "valid";
        if (h.auto) {
          // machine-made rules: a weak hint, once per file, and none at all for properly signed programs
          if (!it.findings.some((f) => f.id === "yara-auto")) it.findings.push({ id: "yara-auto", weight: 3, label: `Shares code with ${familyOf(h.rule)} malware (a machine-made rule that can also match common library code)`, detail: h.rule, counted: !signed });
        } else if ((h.score === null || h.score >= 75) && !signed) {
          // YARA Forge scores its rules 0-100; strong hand-written rules are evidence
          it.detections.push({ source: "yara", name });
        } else if (!it.findings.some((f) => f.id === `yara:${h.rule}`)) {
          it.findings.push({ id: `yara:${h.rule}`, weight: h.score === null || h.score >= 60 ? 5 : 3, label: `Matches the YARA rule ${h.rule}${signed ? " (but it is properly signed)" : ""}`, detail: h.description, counted: true });
        }
      }
      for (const it of items) rescore(it);
      onEvent({ type: "yara", done: targets.length, total: targets.length });
    } catch (err) {
      if (signal?.aborted) throw err;
      errors.push(`yara: ${err.message}`);
    }
  }

  // 6. Malware databases, by hash only.
  const ranked = items.filter((it) => it.f.sha256 && (it.score >= 3 || (it.f.kind === "pe" && isUserPlace(it.c.path)))).sort((a, b) => b.score - a.score);
  if (keys.malwareBazaar && ranked.length) {
    onEvent({ type: "phase", phase: "reputation" });
    for (const [i, it] of ranked.slice(0, 100).entries()) {
      signal?.throwIfAborted();
      try {
        const r = await malwareBazaar(it.f.sha256, keys.malwareBazaar, { fetchImpl, signal });
        it.reputation.push(r);
        if (r.found) it.detections.push({ source: "malwarebazaar", name: `Known malware sample: ${r.label}` });
      } catch (err) {
        if (signal?.aborted) throw err;
        errors.push(err.message);
        break;
      }
      onEvent({ type: "reputation", done: i + 1, total: Math.min(100, ranked.length) });
    }
  }
  if (keys.virusTotal && ranked.length) {
    onEvent({ type: "phase", phase: "reputation" });
    for (const [i, it] of ranked.filter((x) => x.score >= 3).slice(0, 4).entries()) {
      signal?.throwIfAborted();
      if (i) await new Promise((r) => setTimeout(r, 15_500)); // free tier: 4 lookups a minute
      try {
        const r = await virusTotal(it.f.sha256, keys.virusTotal, { fetchImpl, signal });
        it.reputation.push(r);
        if (r.found && r.malicious >= 5) it.detections.push({ source: "virustotal", name: `${r.malicious} of ${r.total} antivirus engines${r.label ? `: ${r.label}` : ""}` });
        else if (r.found && r.malicious > 0) it.findings.push({ id: "virustotal-some", weight: 3, label: `${r.malicious} of ${r.total} antivirus engines on VirusTotal flag it`, detail: r.label, counted: true });
        else if (r.found && r.total > 20) it.findings.push({ id: "virustotal-clean", weight: 0, label: `VirusTotal: none of ${r.total} engines flag it`, detail: null, counted: false });
      } catch (err) {
        if (signal?.aborted) throw err;
        errors.push(err.message);
        break;
      }
    }
  }

  // 6b. CIRCL hashlookup: is a flagged file a known legitimate file, or a known malicious sample?
  if (online) {
    const flagged = items.filter((it) => it.f.sha256 && it.score >= 3 && !it.detections.length).sort((a, b) => b.score - a.score).slice(0, 80);
    if (flagged.length) {
      onEvent({ type: "phase", phase: "reputation" });
      let n = 0;
      let failed = false;
      await pool(flagged, 4, async (it) => {
        if (failed) return;
        try {
          const r = await hashLookup(it.f.sha256, { fetchImpl, signal });
          if (r.malicious) it.detections.push({ source: "hashlookup", name: `A known malicious sample (CIRCL hashlookup, reported by ${r.malicious})` });
          else if (r.known) {
            it.adjust -= 4;
            it.findings.push({ id: "known-good", weight: 0, label: "A known legitimate file (CIRCL hashlookup)", detail: r.name ?? null, counted: false });
          }
          it.reputation.push({ source: "hashlookup", found: r.known, label: r.malicious ?? r.name ?? null });
          rescore(it);
        } catch (err) {
          if (signal?.aborted) throw err;
          failed = true;
          errors.push(`hashlookup: ${err.message}`);
        }
        onEvent({ type: "reputation", done: ++n, total: flagged.length });
      }, signal);
    }
  }

  // 7. Gemini's second opinion on what the rules flagged. It can move a score, never prove a threat.
  const forAi = items.filter((it) => it.score >= 3 && !it.detections.length).sort((a, b) => b.score - a.score).slice(0, 60);
  let aiError = null;
  let model = null;
  if (ai && forAi.length) {
    onEvent({ type: "phase", phase: "ai" });
    const gemini = new Gemini({ ...ai, signal });
    try {
      for (let i = 0; i < forAi.length; i += 30) {
        const batch = forAi.slice(i, i + 30);
        const out = await gemini.generate({
          systemInstruction: { parts: [{ text: AI_PROMPT }] },
          contents: [{
            role: "user",
            parts: [{
              text: JSON.stringify(batch.map((it, j) => ({
                id: j + 1,
                name: it.f.name,
                folder: homeMasked(path.dirname(it.c.path)),
                sizeKB: Math.round(it.f.size / 1024),
                kind: it.f.kind,
                signer: it.signer ? `${it.signer.status}${it.signer.subject ? ` (${it.signer.subject})` : ""}` : "not checked",
                downloadedFrom: it.f.zone?.url ? new URL(it.f.zone.url).hostname : null,
                startsWithWindows: Boolean(it.c.autostart),
                findings: it.findings.filter((x) => x.counted).map((x) => x.label),
              }))),
            }],
          }],
          generationConfig: { temperature: 0.1, responseMimeType: "application/json", responseSchema: AI_SCHEMA },
        });
        for (const r of out.results ?? []) {
          const it = batch[r.id - 1];
          if (!it) continue;
          it.ai = { verdict: r.verdict, confidence: Math.max(0, Math.min(1, Number(r.confidence) || 0)), reason: String(r.reason ?? "").slice(0, 160) };
          if (it.ai.confidence >= 0.7 && it.ai.verdict === "likely-benign") it.adjust -= 3;
          if (it.ai.confidence >= 0.7 && it.ai.verdict === "likely-malicious") it.adjust += 3;
          rescore(it);
        }
        onEvent({ type: "ai", done: Math.min(i + 30, forAi.length), total: forAi.length });
      }
      model = [...gemini.used].join(", ") || null;
    } catch (err) {
      if (signal?.aborted) throw err;
      aiError = err.message;
    }
  }

  // 7b. Behavior: what is running right now, what it talks to, and which drivers are loaded.
  let live = null;
  if (behavior) {
    onEvent({ type: "phase", phase: "behavior" });
    try {
      const snap = await snapshot({ run, signal });
      const images = [...new Set(snap.processes.map((p) => p.path).filter((p) => p && !/^[a-z]:\\windows\\/i.test(p)))];
      const procSigners = new Map(signers);
      const missing = images.filter((p) => !procSigners.has(p.toLowerCase()) && fs.existsSync(p));
      if (missing.length) for (const [k, v] of await checkSignatures(missing, { run, signal })) procSigners.set(k, v);
      live = analyzeBehavior(snap, { signers: procSigners, intel });
    } catch (err) {
      if (signal?.aborted) throw err;
      errors.push(`behavior: ${err.message}`);
    }
  }

  // 8. Results.
  const results = [];
  for (const it of items) {
    const isTrusted = it.f.sha256 && trusted[it.f.sha256];
    const severity = it.detections.length ? "threat" : it.level;
    if (severity === "clean" || (isTrusted && severity !== "threat")) continue;
    results.push({
      id: results.length + 1,
      path: it.c.path,
      name: it.f.name,
      size: it.f.size,
      mtime: it.f.mtime,
      kind: it.f.kind,
      sha256: it.f.sha256,
      severity,
      score: it.score,
      findings: it.findings,
      detections: it.detections,
      signer: it.signer,
      zone: it.f.zone,
      autostart: it.c.autostart ? pickStartup(it.c.autostart) : null,
      ai: it.ai,
      reputation: it.reputation,
      trusted: Boolean(isTrusted),
      status: "found",
    });
  }
  const rank = { threat: 0, suspicious: 1, notice: 2 };
  results.sort((a, b) => rank[a.severity] - rank[b.severity] || b.score - a.score);
  results.forEach((r, i) => (r.id = i + 1));

  const byTarget = new Map(items.map((it) => [it.c.path.toLowerCase(), it]));
  const startupView = startups.map((s) => {
    const it = s.target ? byTarget.get(s.target.toLowerCase()) : null;
    const odd = winlogonOdd(s);
    const severity = it?.detections.length ? "threat" : odd || s.lolbin ? "suspicious" : it ? it.level : "clean";
    return {
      ...pickStartup(s),
      signer: it?.signer ?? null,
      severity: severity === "clean" && s.missing && s.source !== "winlogon" ? "missing" : severity,
      reasons: [
        ...(odd ? [`Winlogon ${s.name} differs from the Windows default`] : []),
        ...(it ? it.findings.filter((x) => x.counted).map((x) => x.label) : []),
        ...(it?.detections ?? []).map((d) => d.name),
      ],
    };
  });

  return {
    mode,
    roots: jobs.map((j) => j.dir),
    startedAt: started,
    durationMs: Date.now() - started,
    stats: {
      filesSeen,
      inspected: list.length,
      cloudOnly,
      programs: facts.filter((f) => f?.kind === "pe").length,
      signed: [...signers.values()].filter((s) => s.status === "valid").length,
      startups: startups.length,
      threats: results.filter((r) => r.severity === "threat").length,
      suspicious: results.filter((r) => r.severity === "suspicious").length,
      notices: results.filter((r) => r.severity === "notice").length,
      liveFlags: live ? live.processes.length + live.drivers.length : 0,
    },
    engines: { ...engines, defenderReason: defender.reason ?? null, model, aiError },
    results,
    startups: startupView,
    behavior: live,
    errors,
  };
}

// Score = the counted warning signs plus outside opinions (Gemini, known-good lists), never below zero.
function rescore(it) {
  it.score = Math.max(0, it.findings.filter((f) => f.counted).reduce((s, f) => s + f.weight, 0) + (it.adjust ?? 0));
  it.level = it.score >= 6 ? "suspicious" : it.score >= 4 ? "notice" : "clean";
}

// MALPEDIA_Win_Triback_Loader_Auto -> Triback Loader
function familyOf(rule) {
  return rule.replace(/^MALPEDIA_(Win|Elf|Osx|Apk|Jar|Js|Ps1|Py|Vbs)_/i, "").replace(/_Auto$/i, "").replace(/_/g, " ");
}

function isUserPlace(p) {
  const place = placeOf(p);
  return place.downloads || place.desktop || place.temp || place.startup || place.publicUser || place.roaming;
}

const pickStartup = (s) => ({ id: s.id, source: s.source, location: s.location, name: s.name, command: s.command, target: s.target, missing: s.missing, publisher: s.publisher, lolbin: s.lolbin ?? null });

export { PE_EXT };
