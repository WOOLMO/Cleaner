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

// The threat scan: an on-demand second opinion next to the real-time antivirus.
// Severity: "threat" needs hard evidence (a known-bad hash, an antivirus engine, a malware database);
// rules and Gemini can only make something "suspicious" or a "notice", always with reasons.

export const LAST_THREAT_SCAN = path.join(DATA_DIR, "last-threat-scan.json");

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
  signal,
  onEvent = () => {},
  run = runPowerShell,
  fetchImpl = globalThis.fetch,
} = {}) {
  const started = Date.now();
  const engines = { rules: true, hashList: true, defender: null, malwareBazaar: Boolean(keys.malwareBazaar), virusTotal: Boolean(keys.virusTotal), gemini: Boolean(ai) };
  const errors = [];
  const blocklist = loadBlocklist(blocklists);
  const trusted = loadTrusted();

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
    for (const f of listing.files) {
      if (candidates.size >= MAX_CANDIDATES) break;
      const why = isCandidate(f.name, f.path);
      if (!why) continue;
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
      .map((d) => ({ dir: d.path, depth: job.depth - 1 }));
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
  await pool(list, CONCURRENCY, async (c, i) => {
    facts[i] = await examine(c.path, { size: c.size, mtime: c.mtime, signal });
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
  let signers = new Map();
  try {
    signers = await checkSignatures(needSig, { run, signal });
  } catch (err) {
    if (signal?.aborted) throw err;
    errors.push(`signatures: ${err.message}`);
  }
  onEvent({ type: "signatures", checked: signers.size });

  // 5. Verdicts from the rules, then hard evidence.
  const items = list.map((c, i) => {
    const f = facts[i];
    const signer = signers.get(c.path.toLowerCase()) ?? null;
    const verdict = judge(f, { signer, autostart: c.autostart });
    const detections = [];
    const listed = blocklist.get(f.sha256) ?? (f.trimmedSha256 ? blocklist.get(f.trimmedSha256) : undefined);
    if (listed) detections.push({ source: "hash", name: listed });
    return { c, f, signer, ...verdict, detections, ai: null, reputation: [] };
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
          if (it.ai.confidence >= 0.7 && it.ai.verdict === "likely-benign") it.score = Math.max(0, it.score - 3);
          if (it.ai.confidence >= 0.7 && it.ai.verdict === "likely-malicious") it.score += 3;
          it.level = it.score >= 6 ? "suspicious" : it.score >= 3 ? "notice" : "clean";
        }
        onEvent({ type: "ai", done: Math.min(i + 30, forAi.length), total: forAi.length });
      }
      model = [...gemini.used].join(", ") || null;
    } catch (err) {
      if (signal?.aborted) throw err;
      aiError = err.message;
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
    },
    engines: { ...engines, defenderReason: defender.reason ?? null, model, aiError },
    results,
    startups: startupView,
    errors,
  };
}

function isUserPlace(p) {
  const place = placeOf(p);
  return place.downloads || place.desktop || place.temp || place.startup || place.publicUser || place.roaming;
}

const pickStartup = (s) => ({ id: s.id, source: s.source, location: s.location, name: s.name, command: s.command, target: s.target, missing: s.missing, publisher: s.publisher, lolbin: s.lolbin ?? null });

export { PE_EXT };
