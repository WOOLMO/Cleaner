import fs from "node:fs";
import path from "node:path";
import { runThreatScan, saveThreatScan } from "./protect.js";
import { loadBlocklist } from "./reputation.js";
import { intelStatus, updateIntel } from "./intel.js";
import { yaraStatus, installYara, updateYaraRules } from "./yara.js";
import { quarantineFile, listQuarantine, restoreQuarantined, deleteQuarantined } from "./quarantine.js";
import { audit } from "./audit.js";
import { desktopDir } from "./script.js";
import { askKey, askLine } from "./input.js";
import { c, logLine, Task, box, rule, columns, detailRoom, formatSize, shortPath, truncateMiddle, truncateEnd } from "./ui.js";

// `cleaner protect` and `cleaner quarantine`: the threat scan in the terminal.

function parseIds(text) {
  const ids = new Set();
  for (const part of text.split(/[\s,]+/).filter(Boolean)) {
    const m = part.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) continue;
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) ids.add(i);
  }
  return ids;
}

export async function runProtect(args, opts, { banner, applyPolicy, geminiSetup }) {
  banner();
  const policy = applyPolicy(opts);
  const mode = args[0] === "full" ? "full" : args.length && args[0] !== "quick" ? "custom" : "quick";
  const roots = mode === "custom" ? args.map((a) => path.resolve(a)) : [];
  for (const r of roots) if (!fs.existsSync(r)) throw new Error(`folder not found: ${r}`);

  const { useAi, apiKey, models } = geminiSetup(opts);
  const online = !opts.offline && !opts.policyNoAi;
  const keys = online ? { malwareBazaar: process.env.MALWAREBAZAAR_KEY || null, virusTotal: process.env.VIRUSTOTAL_KEY || null } : {};
  const blocklists = policy?.blocklistFile ? [policy.blocklistFile] : [];
  logLine("info", "hash list", `${loadBlocklist(blocklists).size} known-bad hashes, plus your blocklist.txt`);
  logLine(keys.malwareBazaar ? "ok" : "skip", "malwarebazaar", keys.malwareBazaar ? "hash lookups on" : "add MALWAREBAZAAR_KEY to look hashes up (free)");
  logLine(keys.virusTotal ? "ok" : "skip", "virustotal", keys.virusTotal ? "hash lookups on, 4 a minute" : "add VIRUSTOTAL_KEY to look hashes up (free)");
  if (online && (keys.malwareBazaar || keys.virusTotal)) logLine("info", "privacy", "only SHA-256 hashes go to the malware databases");
  const intel = intelStatus();
  const feeds = Object.values(intel).filter((f) => f.count);
  logLine(feeds.length ? "ok" : "info", "threat intel", feeds.length ? `${feeds.length} open feeds: ${feeds.map((f) => `${f.label} ${f.count.toLocaleString()}`).join(", ")}` : online ? "downloading the open feeds (abuse.ch, LOLDrivers)" : "no feeds yet, run cleaner intel");
  const yara = yaraStatus();
  logLine(yara.ready ? "ok" : "skip", "yara", yara.ready ? `${yara.rules?.count?.toLocaleString() ?? "?"} YARA Forge rules (${yara.rules?.release ?? "?"})` : "not installed, run cleaner yara install");
  logLine("ok", "target", mode === "quick" ? "startup entries, Downloads, Desktop, temp folders, AppData" : mode === "full" ? "your whole user folder" : roots.map(shortPath).join(", "));
  console.log();

  const task = new Task("threat scan").animate();
  const result = await runThreatScan({
    mode,
    roots,
    desktop: mode === "quick" ? desktopDir() : null,
    includeDev: Boolean(opts.dev),
    ai: useAi ? { apiKey, models } : null,
    keys,
    blocklists,
    online,
    onEvent: (e) => {
      if (e.type === "phase") task.label = PHASES[e.phase] ?? e.phase;
      else if (e.type === "walk") task.update(c.gray(truncateMiddle(`${e.files.toLocaleString()} files, ${e.candidates.toLocaleString()} to inspect  ${shortPath(e.current)}`, detailRoom())));
      else if (e.type === "inspect") task.update(c.gray(truncateMiddle(`${e.done}/${e.total}  ${shortPath(e.current)}`, detailRoom())));
      else if (e.type === "defender" || e.type === "reputation" || e.type === "ai") task.update(c.gray(`${e.done}/${e.total}`));
    },
  });
  task.label = "threat scan";
  task.done(`${result.stats.inspected.toLocaleString()} files inspected in ${(result.durationMs / 1000).toFixed(1)}s`);
  logLine(result.engines.defender ? "ok" : "skip", "defender", result.engines.defender ? "engine checked the risky files" : result.engines.defenderReason ?? "not available");
  if (result.engines.aiError) logLine("warn", "gemini", result.engines.aiError);
  for (const e of result.errors) logLine("warn", "note", e);
  saveThreatScan(result);
  audit("threat-scan", { mode, roots: result.roots, files: result.stats.inspected, threats: result.stats.threats, suspicious: result.stats.suspicious });
  console.log();

  const s = result.stats;
  box("threat scan", [
    `${c.gray("inspected".padEnd(11))}${c.white(`${s.inspected.toLocaleString()} files, ${s.programs.toLocaleString()} programs, ${s.signed.toLocaleString()} verified signatures`)}`,
    `${c.gray("startup".padEnd(11))}${c.white(`${s.startups} things start with Windows`)}`,
    "",
    `${c.red("threats".padEnd(11))}${c.white(String(s.threats).padStart(4))}   ${c.gray("known malware: a hash list or an antivirus engine says so")}`,
    `${c.amber("suspicious".padEnd(11))}${c.white(String(s.suspicious).padStart(4))}   ${c.gray("strong warning signs, worth checking")}`,
    `${c.gray("notices".padEnd(11))}${c.white(String(s.notices).padStart(4))}   ${c.gray("weak signs, usually fine")}`,
  ]);
  console.log();

  if (result.results.length) {
    rule("findings");
    const width = columns();
    for (const r of result.results.slice(0, 60)) {
      const why = r.detections.length ? r.detections.map((d) => d.name).join("; ") : r.findings.filter((f) => f.counted).map((f) => f.label).join("; ");
      console.log(`  ${c.dim(String(r.id).padStart(3, "0"))}  ${TAG[r.severity](LABEL[r.severity])}  ${c.white(truncateMiddle(shortPath(r.path), Math.max(20, width - 18)))}`);
      console.log(`  ${" ".repeat(14)}${c.faint("└─")} ${c.dim(truncateEnd(why, Math.max(20, width - 21)))}`);
      if (r.ai) console.log(`  ${" ".repeat(17)}${c.faint("gemini:")} ${c.dim(truncateEnd(`${r.ai.verdict}, ${r.ai.reason}`, Math.max(20, width - 29)))}`);
    }
    if (result.results.length > 60) console.log(c.gray(`  …and ${result.results.length - 60} more in the desktop app`));
    console.log();
  }
  const live = result.behavior;
  if (live && (live.processes.length || live.drivers.length)) {
    rule("running now");
    for (const p of live.processes.slice(0, 20)) {
      const why = p.detections.length ? p.detections.map((d) => d.name).join("; ") : p.findings.map((f) => f.label).join("; ");
      console.log(`  ${TAG[p.severity]?.(LABEL[p.severity]) ?? p.severity}  ${c.white(`${p.name} (pid ${p.pid})`)}  ${c.gray(truncateMiddle(shortPath(p.path ?? ""), Math.max(20, columns() - 40)))}`);
      console.log(`  ${" ".repeat(9)}${c.faint("└─")} ${c.dim(truncateEnd(why, columns() - 16))}`);
    }
    for (const d of live.drivers) {
      console.log(`  ${TAG[d.severity]?.(LABEL[d.severity]) ?? d.severity}  ${c.white(`driver ${d.name}`)}  ${c.gray(truncateMiddle(shortPath(d.path ?? ""), Math.max(20, columns() - 40)))}`);
      console.log(`  ${" ".repeat(9)}${c.faint("└─")} ${c.dim(truncateEnd(d.label, columns() - 16))}`);
    }
    console.log(c.gray(`  ${live.stats.processes} programs running, ${live.stats.external} internet connections, ${live.stats.drivers} drivers loaded`));
    console.log();
  }
  const odd = result.startups.filter((x) => x.severity !== "clean");
  if (odd.length) {
    rule("startup entries to look at");
    for (const x of odd.slice(0, 30)) {
      const tag = x.severity === "missing" ? c.gray("missing") : TAG[x.severity]?.(LABEL[x.severity].trim()) ?? x.severity;
      console.log(`  ${tag.padEnd(9)} ${c.white(truncateEnd(x.name, 34).padEnd(34))} ${c.gray(truncateMiddle(shortPath(x.target ?? x.command), Math.max(20, columns() - 50)))}`);
      if (x.reasons.length) console.log(`  ${" ".repeat(10)}${c.faint("└─")} ${c.dim(truncateEnd(x.reasons.join("; "), columns() - 16))}`);
      else if (x.severity === "missing") console.log(`  ${" ".repeat(10)}${c.faint("└─")} ${c.dim("points to a file that no longer exists; harmless, but the entry can go")}`);
    }
    console.log();
  }

  const threats = result.results.filter((r) => r.severity === "threat");
  const suspects = result.results.filter((r) => r.severity === "suspicious");
  if (!threats.length && !suspects.length) {
    logLine("ok", "clean", "nothing that looks like malware");
    console.log();
    return;
  }
  box("quarantine", [
    `${c.hi("1")}  ${c.white("the threats".padEnd(28))} ${c.gray(`${threats.length} files`)}`,
    `${c.hi("2")}  ${c.white("threats + suspicious".padEnd(28))} ${c.gray(`${threats.length + suspects.length} files`)}`,
    `${c.hi("3")}  ${c.white("let me pick by number".padEnd(28))} ${c.gray("for example 1,3-5")}`,
    `${c.hi("4")}  ${c.white("nothing")}`,
  ]);
  const choice = await askLine(`\n  ${c.hi(">")} ${c.white("choose 1-4")} `);
  let picked = choice === "1" ? threats : choice === "2" ? [...threats, ...suspects] : [];
  if (choice === "3") {
    const ids = parseIds(await askLine(`  ${c.hi(">")} ${c.white("numbers")} `));
    picked = result.results.filter((r) => ids.has(r.id));
  }
  console.log();
  if (!picked.length) {
    logLine("ok", "nothing", "no files were moved");
    console.log();
    return;
  }
  const yes = await askKey(`  ${c.hi(">")} ${c.white(`move ${picked.length} files to quarantine? they stop working until restored`)} ${c.gray("[y/N]")} `);
  console.log();
  if (!yes) {
    logLine("ok", "cancelled", "no files were moved");
    console.log();
    return;
  }
  quarantine(picked, result, { app: "cli" });
  console.log();
  console.log(`  ${c.gray("Put a file back with")} ${c.hi("cleaner quarantine restore <number>")}${c.gray(".")}\n`);
}

export function quarantine(picked, result, { app }) {
  const done = [];
  for (const r of picked) {
    try {
      quarantineFile(r.path, { reason: r.detections[0]?.name ?? r.findings.find((f) => f.counted)?.label ?? null, sha256: r.sha256, severity: r.severity });
      r.status = "quarantined";
      done.push(r);
      logLine("ok", "quarantined", shortPath(r.path));
    } catch (err) {
      r.status = "failed";
      logLine("fail", "not moved", `${shortPath(r.path)}: ${err.message}`);
    }
  }
  saveThreatScan(result);
  audit("quarantine", { app, items: done.map((r) => ({ path: r.path, size: r.size, result: r.severity })) });
  return done;
}

// `cleaner intel`: refresh the open threat-intel feeds now.
export async function runIntel(args, { banner }) {
  banner();
  const task = new Task("threat intel").animate();
  const report = await updateIntel({ force: true, onProgress: (p) => task.update(c.gray(p.label)) });
  task.done("updated");
  for (const [name, r] of Object.entries(report)) logLine(r.ok ? "ok" : "warn", name, r.ok ? `${r.count.toLocaleString()} entries` : r.error);
  console.log(c.gray("\n  Public lists only; nothing about this PC was sent.\n"));
}

// `cleaner yara install` / `cleaner yara update`: the YARA engine and the YARA Forge core rules.
export async function runYara(args, { banner }) {
  banner();
  const status = yaraStatus();
  const action = args[0] === "update" ? "update" : args[0] === "install" ? "install" : null;
  logLine(status.ready ? "ok" : "info", "yara", status.ready ? `engine ${status.engine?.version}, ${status.rules?.count?.toLocaleString()} rules (${status.rules?.release})` : "not installed");
  if (!action) {
    console.log(`\n  ${c.gray("Install with")} ${c.hi("cleaner yara install")}${c.gray(", refresh the rules with")} ${c.hi("cleaner yara update")}${c.gray(".")}\n`);
    return;
  }
  if (action === "update" && !status.ready) throw new Error("YARA is not installed yet, run cleaner yara install");
  const what = action === "install" ? "the YARA engine (VirusTotal, about 2 MB) and the YARA Forge core rules (about 2 MB)" : "the latest YARA Forge core rules (about 2 MB)";
  console.log();
  const yes = await askKey(`  ${c.hi(">")} ${c.white(`download ${what} from GitHub? each file must match its published checksum`)} ${c.gray("[y/N]")} `);
  console.log();
  if (!yes) {
    logLine("ok", "cancelled", "nothing was downloaded");
    console.log();
    return;
  }
  const task = new Task(action === "install" ? "installing yara" : "updating rules").animate();
  const r = action === "install" ? await installYara({ onProgress: (s) => task.update(c.gray(s)) }) : { rules: await updateYaraRules({ onProgress: (s) => task.update(c.gray(s)) }) };
  task.done(`${r.rules.count.toLocaleString()} rules ready (${r.rules.release})`);
  console.log();
}

export async function runQuarantine(args, { banner }) {
  banner();
  const list = listQuarantine();
  const [action, which] = args;
  if (!list.length) {
    logLine("ok", "quarantine", "empty");
    console.log();
    return;
  }
  rule("quarantine");
  list.forEach((q, i) => {
    console.log(`  ${c.dim(String(i + 1).padStart(2, "0"))}  ${c.white(formatSize(q.size).padStart(9))}  ${c.gray(truncateMiddle(shortPath(q.original), columns() - 18))}`);
    if (q.reason) console.log(`  ${" ".repeat(13)}${c.faint("└─")} ${c.dim(truncateEnd(`${q.reason}, ${new Date(q.time).toLocaleString()}`, columns() - 18))}`);
  });
  console.log();
  if (action !== "restore" && action !== "delete") {
    console.log(`  ${c.gray("Put one back with")} ${c.hi("cleaner quarantine restore <number>")}${c.gray(", or remove it for good with")} ${c.hi("cleaner quarantine delete <number>")}${c.gray(".")}\n`);
    return;
  }
  const picked = [...parseIds(which ?? "")].map((n) => list[n - 1]).filter(Boolean);
  if (!picked.length) throw new Error(`which one? for example: cleaner quarantine ${action} 1`);
  const verb = action === "restore" ? "put back" : "delete for good";
  const yes = await askKey(`  ${c.hi(">")} ${c.white(`${verb} ${picked.length} file${picked.length === 1 ? "" : "s"}?`)} ${c.gray("[y/N]")} `);
  console.log();
  if (!yes) {
    logLine("ok", "cancelled", "nothing changed");
    console.log();
    return;
  }
  for (const q of picked) {
    try {
      if (action === "restore") restoreQuarantined(q.id);
      else deleteQuarantined(q.id);
      logLine("ok", action === "restore" ? "restored" : "deleted", shortPath(q.original));
    } catch (err) {
      logLine("fail", "failed", `${shortPath(q.original)}: ${err.message}`);
    }
  }
  audit(action === "restore" ? "quarantine-restore" : "quarantine-delete", { items: picked.map((q) => ({ path: q.original, size: q.size, result: action })) });
  console.log();
}
