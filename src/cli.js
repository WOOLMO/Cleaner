import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadEnv, DEFAULTS, ROOT } from "./config.js";
import { scan } from "./scan.js";
import { inspectFile } from "./inspect.js";
import { Gemini, classifyItems } from "./gemini.js";
import { makeHeader, writeDb, readDb } from "./db.js";
import { isSafeToRemove, removePermanently, freeBytes } from "./remove.js";
import { writeRemovalScript } from "./script.js";
import { askKey, askLine, closeInput } from "./input.js";
import {
  c, banner, logLine, Task, box, bar, rule, verdictTag, columns, detailRoom,
  formatSize, shortPath, truncateMiddle, truncateEnd,
} from "./ui.js";

const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
const sum = (list) => list.reduce((total, e) => total + e.size, 0);
const seconds = (ms) => `${(ms / 1000).toFixed(1)}s`;

function parseArgs(argv) {
  const opts = { exclude: [] };
  const args = [];
  let cmd = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${arg} needs a value`);
      return v;
    };
    switch (arg) {
      case "-h":
      case "--help": cmd = "help"; break;
      case "--offline": opts.offline = true; break;
      case "--no-content": opts.noContent = true; break;
      case "--dry-run": opts.dryRun = true; break;
      case "--db": opts.db = path.resolve(value()); break;
      case "--out": opts.out = path.resolve(value()); break;
      case "--model": opts.model = value(); break;
      case "--max-ai": opts.maxAi = Math.max(0, parseInt(value(), 10) || 0); break;
      case "--large": opts.largeMB = Math.max(1, parseFloat(value()) || DEFAULTS.largeFileMB); break;
      case "--exclude": opts.exclude.push(path.resolve(value()).toLowerCase()); break;
      default:
        if (arg.startsWith("-")) throw new Error(`unknown option ${arg}, see cleaner --help`);
        if (!cmd && ["scan", "clean", "list", "export", "help"].includes(arg)) cmd = arg;
        else args.push(arg);
    }
  }
  return { cmd: cmd ?? "scan", args, opts };
}

function help() {
  banner(VERSION);
  const line = (a, b) => console.log(`  ${c.hi(a.padEnd(30))}${c.gray(b)}`);
  rule("usage");
  line("cleaner scan [folders...]", "scan (default: your user folder), then y/N");
  line("cleaner clean", "pick items from the last scan and delete them");
  line("cleaner list", "show the last scan");
  line("cleaner export", "write the removal script from the last scan");
  console.log();
  rule("options");
  line("--offline", "local rules only, nothing goes to gemini");
  line("--no-content", "gemini gets names, sizes and dates, no previews");
  line("--max-ai <n>", `ask gemini about at most n items (default ${DEFAULTS.maxAi})`);
  line("--large <MB>", `also ask about files over this size (default ${DEFAULTS.largeFileMB})`);
  line("--exclude <dir>", "skip a folder, repeatable");
  line("--model <name>", "try this gemini model first");
  line("--db <file>", "database file (default cleaner-db.txt)");
  line("--out <dir>", "where the removal script goes (default: next to the db)");
  line("--dry-run", "with clean: list, delete nothing");
  console.log();
}

function printEntries(list) {
  const width = columns();
  const pathRoom = Math.max(20, width - 33);
  console.log(c.faint(`  ${"id".padEnd(3)}  ${"size".padStart(9)}  ${"verdict".padEnd(9)}  path`));
  for (const e of list) {
    const reasonRoom = Math.max(20, width - 28 - e.category.length);
    console.log(`  ${c.dim(String(e.id).padStart(3, "0"))}  ${c.white(formatSize(e.size).padStart(9))}  ${verdictTag(e)}  ${c.gray(truncateMiddle(shortPath(e.path), pathRoom))}`);
    console.log(`  ${" ".repeat(16)}${c.faint("└─")} ${c.mid(e.category)}${c.faint(" :: ")}${c.dim(truncateEnd(e.reason, reasonRoom))}`);
  }
}

function reportBox(entries, { roots, stats, elapsed, candidates, checked, model, leftOut }) {
  const safe = entries.filter((e) => e.verdict === "remove");
  const yours = entries.filter((e) => e.verdict === "review");
  const total = sum(entries) || 1;
  const row = (label, color, list, share) =>
    `${color(label.padEnd(10))} ${c.white(`${String(list.length).padStart(4)} items`)}  ${c.white(formatSize(sum(list)).padStart(10))}   ${bar(share, 22)}`;
  box("scan report", [
    `${c.gray("target".padEnd(10))} ${c.white(truncateMiddle(roots.map(shortPath).join(", "), 58))}`,
    `${c.gray("scanned".padEnd(10))} ${c.white(`${stats.files.toLocaleString()} files, ${formatSize(stats.bytes)}`)}`,
    `${c.gray("reviewed".padEnd(10))} ${c.white(truncateMiddle(`${candidates} candidates, ${checked} checked by ${model}`, 58))}`,
    `${c.gray("took".padEnd(10))} ${c.white(seconds(elapsed))}`,
    "",
    row("safe", c.hi, safe, sum(safe) / total),
    row("your call", c.amber, yours, sum(yours) / total),
    `${c.gray("kept".padEnd(10))} ${c.white(`${String(leftOut).padStart(4)} items`)}  ${c.gray("looked important, left out")}`,
  ]);
}

// Combines the local rule with Gemini's opinion. "Safe to remove" needs both: a local rule with hard evidence
// (a cache path, an unfinished download, a byte-for-byte duplicate) and Gemini agreeing. Gemini alone can only say "your call".
function decide(item, ai) {
  if (ai && ["remove", "review", "keep"].includes(ai.verdict)) {
    const confidence = Math.max(0, Math.min(1, Number(ai.confidence) || 0));
    let verdict = ai.verdict;
    if (verdict === "remove" && (item.verdict !== "remove" || item.sensitive)) verdict = "review";
    return { verdict, confidence, category: ai.category || item.category, reason: ai.reason || item.reason };
  }
  if (item.verdict === "unknown") return { verdict: "keep" };
  const verdict = item.verdict === "remove" && item.sensitive ? "review" : item.verdict;
  return { verdict, confidence: verdict === "remove" ? 0.8 : 0.5, category: item.category, reason: item.reason };
}

async function deleteEntries(selected, { header, entries, dbFile }) {
  for (const e of selected.filter((x) => !isSafeToRemove(x.path))) logLine("skip", "protected", shortPath(e.path));
  selected = selected.filter((e) => isSafeToRemove(e.path));
  if (!selected.length) return;

  const before = freeBytes(selected[0].path);
  const task = new Task("deleting");
  let removed = 0;
  selected.forEach((e, i) => {
    task.update(`${bar(i / selected.length, 16)} ${c.gray(truncateMiddle(`${i + 1}/${selected.length}  ${shortPath(e.path)}`, detailRoom() - 18))}`);
    e.status = removePermanently(e.path) ? "removed" : "failed";
    if (e.status === "removed") removed++;
  });
  const failed = selected.filter((e) => e.status === "failed");
  task.done(`${removed} of ${selected.length} items removed`, failed.length ? "warn" : "ok");
  for (const e of failed) logLine("fail", "still there", `${shortPath(e.path)} (in use or needs admin rights)`);
  writeDb(dbFile, header, entries);
  const after = freeBytes(selected[0].path);
  if (before !== null && after !== null) {
    logLine("ok", "disk", `${formatSize(Math.max(0, after - before))} reclaimed, ${formatSize(after)} free now`);
  }
  logLine("ok", "database", shortPath(dbFile));
}

function announceScript(files) {
  logLine("ok", "script", shortPath(files.ps1));
  logLine("ok", "launcher", shortPath(files.bat));
  console.log();
  console.log(`  ${c.gray("Nothing was deleted. The script holds the full delete command:")}`);
  console.log(`  ${c.hi(String(files.safe).padStart(4))} ${c.gray("safe items, switched on")}`);
  console.log(`  ${c.amber(String(files.yours).padStart(4))} ${c.gray("your-call items, switched off (remove the # to include one)")}`);
  console.log(`  ${c.gray("Double-click")} ${c.white("cleaner-remove.bat")} ${c.gray("whenever you like. It asks y/N before deleting.")}`);
  console.log(`  ${c.gray("Running it is your call.")}`);
  console.log();
}

async function runScan(args, opts) {
  const roots = (args.length ? args : [os.homedir()]).map((r) => path.resolve(r));
  for (const r of roots) if (!fs.existsSync(r)) throw new Error(`folder not found: ${r}`);
  const dbFile = opts.db ?? DEFAULTS.db;
  const outDir = opts.out ?? path.dirname(dbFile);
  const apiKey = process.env.GEMINI_API_KEY;
  const useAi = !opts.offline && Boolean(apiKey) && opts.maxAi !== 0;
  const models = opts.model
    ? [opts.model, ...DEFAULTS.models.filter((m) => m !== opts.model)]
    : (process.env.GEMINI_MODELS?.split(",").map((s) => s.trim()).filter(Boolean) ?? DEFAULTS.models);

  banner(VERSION);
  const envFile = path.join(ROOT, ".env");
  logLine(fs.existsSync(envFile) ? "ok" : "info", "config", fs.existsSync(envFile) ? shortPath(envFile) : "no .env file");
  if (opts.offline) logLine("skip", "gemini", "--offline, local rules only");
  else if (!apiKey) logLine("warn", "gemini", "no GEMINI_API_KEY, local rules only");
  else if (opts.maxAi === 0) logLine("skip", "gemini", "--max-ai 0, local rules only");
  else logLine("ok", "gemini", `key loaded, ${models[0]}${models.length > 1 ? ` + ${models.length - 1} fallbacks` : ""}`);
  if (useAi) logLine("info", "privacy", opts.noContent ? "names, sizes and dates go to gemini" : "names, sizes, dates and masked previews go to gemini");
  for (const r of roots) logLine("ok", "target", shortPath(r));
  console.log();

  // 1. walk + duplicates
  const started = Date.now();
  const walk = new Task("walking disk");
  let hash = null;
  let walked = null;
  const { items, stats } = await scan(roots, {
    largeFileMB: opts.largeMB ?? DEFAULTS.largeFileMB,
    dupeMinMB: DEFAULTS.dupeMinMB,
    exclude: opts.exclude,
    onProgress: (ev) => {
      if (ev.type === "walk") {
        walk.update(c.gray(truncateMiddle(`${ev.files.toLocaleString()} files  ${formatSize(ev.bytes)}  ${shortPath(ev.current)}`, detailRoom())));
      } else if (ev.type === "walked") {
        walked = ev;
        walk.done(`${ev.files.toLocaleString()} files, ${ev.dirs.toLocaleString()} folders, ${formatSize(ev.bytes)} in ${seconds(ev.ms)}`);
      } else if (ev.type === "hash") {
        hash ??= new Task("hashing copies");
        hash.update(`${bar(ev.done / ev.total, 16)} ${c.gray(`${formatSize(ev.done)} / ${formatSize(ev.total)}`)}`);
      }
    },
  });
  if (!walked) walk.done(`${stats.files.toLocaleString()} files, ${formatSize(stats.bytes)}`);
  const dupes = items.filter((i) => i.category === "duplicate").length;
  if (hash) hash.done(`${dupes} byte-identical copies`);
  else logLine("ok", "hashing copies", `${dupes} byte-identical copies`);

  // 2. look inside the files
  const files = items.filter((i) => i.kind === "file");
  const inspect = new Task("reading content");
  files.forEach((item, n) => {
    inspect.update(c.gray(truncateMiddle(`${n + 1}/${files.length}  ${shortPath(item.path)}`, detailRoom())));
    Object.assign(item, inspectFile(item.path, item.size, { allowPreview: useAi && !opts.noContent && item.verdict !== "remove" }));
  });
  const previews = files.filter((f) => f.preview).length;
  const sensitive = files.filter((f) => f.sensitive).length;
  inspect.done(`${files.length} files sniffed, ${previews} previews, ${sensitive} look sensitive`);

  // 3. gemini
  let aiResults = new Map();
  let model = "local rules";
  let checked = 0;
  if (useAi && items.length) {
    const gemini = new Gemini({ apiKey, models });
    const forAi = [...items].sort((a, b) => b.size - a.size).slice(0, opts.maxAi ?? DEFAULTS.maxAi);
    forAi.forEach((item, i) => (item.aiId = i + 1));
    const ai = new Task("gemini review").animate();
    ai.update(`${bar(0)} ${c.gray(`0/${forAi.length} items`)}`);
    const { results, error } = await classifyItems(forAi, {
      gemini,
      batchSize: DEFAULTS.batchSize,
      onProgress: (done, total) => ai.update(`${bar(done / total)} ${c.gray(`${done}/${total} items`)}`),
    });
    aiResults = results;
    checked = results.size;
    if (gemini.used.size) model = [...gemini.used].join(", ");
    if (error) ai.done(`stopped after ${results.size}/${forAi.length}: ${error.message}`, "warn");
    else ai.done(`${results.size}/${forAi.length} items, ${model}`);
  } else {
    logLine("skip", "gemini review", "local rules only");
  }

  // 4. decide + save
  const entries = [];
  let leftOut = 0;
  for (const item of items) {
    const final = decide(item, item.aiId ? aiResults.get(item.aiId) : null);
    if (final.verdict === "keep") {
      leftOut++;
      continue;
    }
    entries.push({ ...final, size: item.size, path: item.path, status: "pending" });
  }
  entries.sort((a, b) => (a.verdict === b.verdict ? b.size - a.size : a.verdict === "remove" ? -1 : 1));
  entries.forEach((e, i) => (e.id = i + 1));
  const header = makeHeader({ roots, model: useAi ? `local rules + ${model}` : "local rules" });
  writeDb(dbFile, header, entries);
  logLine("ok", "database", shortPath(dbFile));
  console.log();

  reportBox(entries, { roots, stats, elapsed: Date.now() - started, candidates: items.length, checked, model, leftOut });
  if (!entries.length) {
    console.log(`\n  ${c.hi("Clean already. Nothing to remove here.")}\n`);
    return;
  }

  console.log();
  rule("findings");
  printEntries(entries.slice(0, 20));
  if (entries.length > 20) console.log(c.gray(`  ...and ${entries.length - 20} more in the database`));
  console.log();

  // 5. y/N: delete now, or leave a script
  const safe = entries.filter((e) => e.verdict === "remove");
  if (!safe.length) {
    announceScript(writeRemovalScript(entries, { dir: outDir, roots }));
    return;
  }
  box("what now", [
    "",
    `${c.hi("y")}  ${c.white(`delete the ${safe.length} safe items now`)}  ${c.hi(formatSize(sum(safe)))}  ${c.gray("permanent")}`,
    `${c.amber("n")}  ${c.white("delete nothing, write a removal script instead")}`,
    `   ${c.gray("cleaner-remove.ps1 + .bat, running it later is your call")}`,
    "",
  ]);
  const yes = await askKey(`\n  ${c.hi(">")} ${c.white("delete now?")} ${c.gray("[y/N]")} `);
  console.log();
  if (yes) {
    await deleteEntries(safe, { header, entries, dbFile });
    const left = entries.filter((e) => e.status === "pending" && e.verdict === "review").length;
    if (left) {
      console.log();
      console.log(`  ${c.gray(`${left} your-call items were left alone. Pick them with`)} ${c.hi("cleaner clean")}${c.gray(", or get a script with")} ${c.hi("cleaner export")}${c.gray(".")}`);
    }
    console.log();
  } else {
    announceScript(writeRemovalScript(entries, { dir: outDir, roots }));
  }
}

async function runClean(opts) {
  const dbFile = opts.db ?? DEFAULTS.db;
  const { header, entries } = readDb(dbFile);
  banner(VERSION);
  for (const e of entries) if (e.status === "pending" && !fs.existsSync(e.path)) e.status = "missing";
  const live = entries.filter((e) => e.status === "pending");
  writeDb(dbFile, header, entries);
  if (!live.length) {
    logLine("ok", "database", `nothing left to clean in ${shortPath(dbFile)}`);
    console.log();
    return;
  }
  const safe = live.filter((e) => e.verdict === "remove");

  rule("pending");
  printEntries(live);
  console.log();
  box("pick", [
    `${c.hi("1")}  ${c.white("everything marked safe".padEnd(30))} ${c.gray(`${safe.length} items, ${formatSize(sum(safe))}`)}`,
    `${c.hi("2")}  ${c.white("safe + your-call items".padEnd(30))} ${c.gray(`${live.length} items, ${formatSize(sum(live))}`)}`,
    `${c.hi("3")}  ${c.white("let me pick by id".padEnd(30))} ${c.gray("for example 1,4,7-12")}`,
    `${c.hi("4")}  ${c.white("nothing")}`,
  ]);
  const choice = await askLine(`\n  ${c.hi(">")} ${c.white("choose 1-4")} `);
  let selected = [];
  if (choice === "1") selected = safe;
  else if (choice === "2") selected = live;
  else if (choice === "3") {
    const ids = new Set();
    for (const part of (await askLine(`  ${c.hi(">")} ${c.white("ids")} `)).split(/[\s,]+/).filter(Boolean)) {
      const m = part.match(/^(\d+)(?:-(\d+))?$/);
      if (!m) continue;
      const a = Number(m[1]);
      const b = m[2] ? Number(m[2]) : a;
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) ids.add(i);
    }
    selected = live.filter((e) => ids.has(e.id));
  }
  console.log();
  if (!selected.length) {
    logLine("ok", "nothing", "no items selected, nothing deleted");
    console.log();
    return;
  }
  if (opts.dryRun) {
    for (const e of selected) logLine("info", "would delete", `${formatSize(e.size).padStart(9)}  ${shortPath(e.path)}`);
    logLine("ok", "dry run", "nothing was deleted");
    console.log();
    return;
  }
  const yes = await askKey(`  ${c.hi(">")} ${c.white(`delete ${selected.length} items, ${formatSize(sum(selected))}, permanently?`)} ${c.gray("[y/N]")} `);
  console.log();
  if (!yes) {
    logLine("ok", "cancelled", "nothing was deleted");
    console.log();
    return;
  }
  await deleteEntries(selected, { header, entries, dbFile });
  console.log();
}

function runList(opts) {
  const dbFile = opts.db ?? DEFAULTS.db;
  const { header, entries } = readDb(dbFile);
  banner(VERSION);
  for (const line of header.filter((h) => /created|scanned|classified/.test(h))) {
    const [key, ...rest] = line.replace(/^#\s*/, "").split(": ");
    logLine("info", key, rest.join(": "));
  }
  const pending = entries.filter((e) => e.status === "pending");
  logLine("ok", "pending", `${pending.filter((e) => e.verdict === "remove").length} safe, ${pending.filter((e) => e.verdict === "review").length} your call, ${formatSize(sum(pending))}`);
  console.log();
  rule("database");
  printEntries(entries);
  console.log();
}

function runExport(opts) {
  const dbFile = opts.db ?? DEFAULTS.db;
  const { header, entries } = readDb(dbFile);
  banner(VERSION);
  const scanned = header.find((h) => h.startsWith("# scanned:"))?.replace("# scanned: ", "").split(" | ") ?? [];
  announceScript(writeRemovalScript(entries, { dir: opts.out ?? path.dirname(dbFile), roots: scanned }));
}

export async function main(argv) {
  try {
    loadEnv();
    const { cmd, args, opts } = parseArgs(argv);
    if (cmd === "help") help();
    else if (cmd === "list") runList(opts);
    else if (cmd === "export") runExport(opts);
    else if (cmd === "clean") await runClean(opts);
    else await runScan(args, opts);
  } catch (err) {
    console.log();
    logLine("fail", "error", err.message);
    console.log();
    process.exitCode = 1;
  } finally {
    closeInput();
  }
}
