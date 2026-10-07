import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadEnv, saveSetting, migrateOldDb, DEFAULTS, DATA_DIR, ENV_FILES, ROOT } from "./config.js";
import { runScanPipeline } from "./pipeline.js";
import { spaceMap, pickUnits } from "./map.js";
import { Gemini, explainFolders } from "./gemini.js";
import { makeHeader, writeDb, readDb } from "./db.js";
import { loadPolicy, isExcludedByPolicy } from "./policy.js";
import { audit } from "./audit.js";
import { isSafeToRemove, removePermanently, freeBytes } from "./remove.js";
import { holdItems, listHeld, restoreHeld, purgeHeld, HOLD_DIR } from "./hold.js";
import { writeRemovalScript, desktopDir } from "./script.js";
import { askKey, askLine, closeInput } from "./input.js";
import { analyzeFolder, rulePlan, aiPlan, applyPlan, undoOrganize, listJournals, organizeBlocked, LANGUAGE_NAMES } from "./organize.js";
import {
  c, banner, logLine, Task, box, bar, rule, verdictTag, columns, detailRoom,
  formatSize, shortPath, truncateMiddle, truncateEnd,
} from "./ui.js";

const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
const COMMANDS = ["scan", "map", "organize", "clean", "list", "export", "restore", "purge", "setup", "help"];
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
      case "-v":
      case "--version": cmd = "version"; break;
      case "--offline": opts.offline = true; break;
      case "--no-content": opts.noContent = true; break;
      case "--dry-run": opts.dryRun = true; break;
      case "--hold": opts.hold = true; break;
      case "--undo": opts.undo = true; break;
      case "--db": opts.db = path.resolve(value()); break;
      case "--out": opts.out = path.resolve(value()); break;
      case "--model": opts.model = value(); break;
      case "--max-ai": opts.maxAi = Math.max(0, parseInt(value(), 10) || 0); break;
      case "--large": opts.largeMB = Math.max(1, parseFloat(value()) || DEFAULTS.largeFileMB); break;
      case "--top": opts.top = Math.max(1, parseInt(value(), 10) || 15); break;
      case "--exclude": opts.exclude.push(path.resolve(value()).toLowerCase()); break;
      default:
        if (arg.startsWith("-")) throw new Error(`unknown option ${arg}, see cleaner --help`);
        if (!cmd && COMMANDS.includes(arg)) cmd = arg;
        else args.push(arg);
    }
  }
  if (process.env.CLEANER_HOLD === "1") opts.hold = true;
  return { cmd: cmd ?? "scan", args, opts };
}

function help() {
  banner(VERSION);
  const line = (a, b) => console.log(`  ${c.hi(a.padEnd(30))}${c.gray(b)}`);
  rule("commands");
  line("cleaner scan [folders...]", "find junk (default: your user folder), then y/N");
  line("cleaner map [folder]", "the biggest folders on the drive, explained");
  line("cleaner organize [folder]", "tidy loose files into folders, your way (default: Desktop)");
  line("cleaner organize --undo", "put the last organize run back");
  line("cleaner clean", "pick items from the last scan and remove them");
  line("cleaner list", "show the last scan");
  line("cleaner export", "write the removal script from the last scan");
  line("cleaner restore", "put held items back where they were");
  line("cleaner purge", "permanently delete held items");
  line("cleaner setup", "save your free Gemini API key");
  console.log();
  rule("options");
  line("--hold", "move items to a holding area instead of deleting");
  line("--offline", "local rules only, nothing goes to gemini");
  line("--no-content", "gemini gets names, sizes and dates, no previews");
  line("--max-ai <n>", `ask gemini about at most n items (default ${DEFAULTS.maxAi})`);
  line("--large <MB>", `also ask about files over this size (default ${DEFAULTS.largeFileMB})`);
  line("--top <n>", "map: how many folders to show (default 15)");
  line("--exclude <dir>", "skip a folder, repeatable");
  line("--model <name>", "try this gemini model first");
  line("--db <file>", "database file");
  line("--out <dir>", "where the removal script goes (default: your Desktop)");
  line("--dry-run", "with clean or organize: show the plan, change nothing");
  console.log();
  console.log(`  ${c.gray("data folder")}  ${c.dim(shortPath(DATA_DIR))}`);
  console.log();
}

// Organization policy wins over command-line options.
let policy = null;
function applyPolicy(opts) {
  policy = loadPolicy();
  if (!policy.managed) return;
  logLine(policy.error ? "warn" : "info", "policy", policy.error ?? `managed by ${policy.organization ?? "your organization"}`);
  if (policy.aiEnabled === false) opts.policyNoAi = true;
  if (policy.allowPreviews === false) opts.noContent = true;
  if (policy.allowPermanentDelete === false) opts.hold = true;
  if (policy.maxAiItems !== undefined) opts.maxAi = Math.min(opts.maxAi ?? DEFAULTS.maxAi, policy.maxAiItems);
}

function geminiSetup(opts) {
  const apiKey = process.env.GEMINI_API_KEY;
  const models = opts.model
    ? [opts.model, ...DEFAULTS.models.filter((m) => m !== opts.model)]
    : (process.env.GEMINI_MODELS?.split(",").map((s) => s.trim()).filter(Boolean) ?? DEFAULTS.models);
  const useAi = !opts.offline && !opts.policyNoAi && Boolean(apiKey) && opts.maxAi !== 0;
  if (opts.policyNoAi) logLine("skip", "gemini", "turned off by policy, local rules only");
  else if (opts.offline) logLine("skip", "gemini", "--offline, local rules only");
  else if (!apiKey) logLine("warn", "gemini", "no API key yet, run cleaner setup (local rules for now)");
  else if (opts.maxAi === 0) logLine("skip", "gemini", "--max-ai 0, local rules only");
  else logLine("ok", "gemini", `key loaded, ${models[0]}${models.length > 1 ? ` + ${models.length - 1} fallbacks` : ""}`);
  return { useAi, apiKey, models };
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

// Deletes, or with --hold moves to the holding area. Updates the database either way.
async function removeEntries(selected, { header, entries, dbFile, hold }) {
  for (const e of selected.filter((x) => !isSafeToRemove(x.path))) logLine("skip", "protected", shortPath(e.path));
  selected = selected.filter((e) => isSafeToRemove(e.path));
  if (!selected.length) return;

  if (hold) {
    const task = new Task("moving to hold");
    const { held } = holdItems(selected);
    audit("hold", { items: selected });
    const failed = selected.filter((e) => e.status === "failed");
    task.done(`${held} of ${selected.length} items held`, failed.length ? "warn" : "ok");
    for (const e of failed) logLine("fail", "not moved", `${shortPath(e.path)} (${e.note ?? "error"})`);
    writeDb(dbFile, header, entries);
    logLine("info", "undo", "cleaner restore puts them back");
    logLine("info", "free space", "cleaner purge deletes them for good");
    logLine("ok", "database", shortPath(dbFile));
    return;
  }

  const before = freeBytes(selected[0].path);
  const task = new Task("deleting");
  let removed = 0;
  for (const [i, e] of selected.entries()) {
    task.update(`${bar(i / selected.length, 16)} ${c.gray(truncateMiddle(`${i + 1}/${selected.length}  ${shortPath(e.path)}`, detailRoom() - 18))}`);
    e.status = removePermanently(e.path) ? "removed" : "failed";
    if (e.status === "removed") removed++;
  }
  audit("delete", { items: selected });
  const failed = selected.filter((e) => e.status === "failed");
  task.done(`${removed} of ${selected.length} items removed`, failed.length ? "warn" : "ok");
  for (const e of failed) logLine("fail", "still there", `${shortPath(e.path)} (in use or needs admin rights)`);
  writeDb(dbFile, header, entries);
  const after = freeBytes(selected[0].path);
  if (before !== null && after !== null) logLine("ok", "disk", `${formatSize(Math.max(0, after - before))} reclaimed, ${formatSize(after)} free now`);
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

  banner(VERSION);
  applyPolicy(opts);
  const { useAi, apiKey, models } = geminiSetup(opts);
  if (useAi) logLine("info", "privacy", opts.noContent ? "names, sizes and dates go to gemini" : "names, sizes, dates and masked previews go to gemini");
  if (opts.hold) logLine("info", "mode", "hold: y moves items aside, nothing is deleted");
  for (const r of roots) logLine("ok", "target", shortPath(r));
  console.log();

  // Each pipeline event drives one status line.
  const tasks = {};
  const onEvent = (ev) => {
    if (ev.type === "walk") {
      tasks.walk ??= new Task("walking disk").animate();
      tasks.walk.update(c.gray(truncateMiddle(`${ev.files.toLocaleString()} files  ${formatSize(ev.bytes)}  ${shortPath(ev.current)}`, detailRoom())));
    } else if (ev.type === "walked") {
      (tasks.walk ?? new Task("walking disk")).done(`${ev.files.toLocaleString()} files, ${ev.dirs.toLocaleString()} folders, ${formatSize(ev.bytes)} in ${seconds(ev.ms)}`);
    } else if (ev.type === "hash") {
      tasks.hash ??= new Task("hashing copies").animate();
      tasks.hash.update(`${bar(ev.done / ev.total, 16)} ${c.gray(`${formatSize(ev.done)} / ${formatSize(ev.total)}`)}`);
    } else if (ev.type === "hashed") {
      if (tasks.hash) tasks.hash.done(`${ev.copies} byte-identical copies`);
      else logLine("ok", "hashing copies", `${ev.copies} byte-identical copies`);
    } else if (ev.type === "inspect") {
      tasks.inspect ??= new Task("reading content");
      tasks.inspect.update(c.gray(truncateMiddle(`${ev.done}/${ev.total}  ${shortPath(ev.current)}`, detailRoom())));
    } else if (ev.type === "inspected") {
      (tasks.inspect ?? new Task("reading content")).done(`${ev.files} files sniffed, ${ev.previews} previews, ${ev.sensitive} look sensitive`);
    } else if (ev.type === "ai") {
      tasks.ai ??= new Task("gemini review").animate();
      tasks.ai.update(`${bar(ev.done / ev.total)} ${c.gray(`${ev.done}/${ev.total} items`)}`);
    } else if (ev.type === "aiDone") {
      if (ev.error) tasks.ai.done(`stopped after ${ev.checked}/${ev.total}: ${ev.error}`, "warn");
      else tasks.ai.done(`${ev.checked}/${ev.total} items, ${ev.model}`);
    }
  };

  const result = await runScanPipeline({
    roots,
    ai: useAi ? { apiKey, models } : null,
    noContent: opts.noContent,
    maxAi: opts.maxAi ?? DEFAULTS.maxAi,
    largeMB: opts.largeMB ?? DEFAULTS.largeFileMB,
    exclude: opts.exclude,
    excludeTest: policy?.managed ? (p) => isExcludedByPolicy(policy, p) : null,
    onEvent,
  });
  const { entries, stats } = result;
  if (!useAi) logLine("skip", "gemini review", "local rules only");

  const header = makeHeader({ roots, model: result.classifiedBy });
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  writeDb(dbFile, header, entries);
  audit("scan", { roots, files: stats.files, bytes: stats.bytes, found: entries.length, classifiedBy: result.classifiedBy });
  logLine("ok", "database", shortPath(dbFile));
  console.log();

  reportBox(entries, {
    roots, stats, elapsed: result.durationMs, candidates: result.candidates, checked: result.checked, model: result.model, leftOut: result.leftOut,
  });
  if (!entries.length) {
    console.log(`\n  ${c.hi("Clean already. Nothing to remove here.")}`);
    console.log(`  ${c.gray("See the biggest folders on the whole drive with")} ${c.hi("cleaner map")}\n`);
    return;
  }

  console.log();
  rule("findings");
  printEntries(entries.slice(0, 20));
  if (entries.length > 20) console.log(c.gray(`  ...and ${entries.length - 20} more in the database`));
  console.log();

  // 5. y/N: remove now, or leave a script
  const safe = entries.filter((e) => e.verdict === "remove");
  const outDir = () => opts.out ?? desktopDir();
  if (!safe.length) {
    announceScript(writeRemovalScript(entries, { dir: outDir(), roots }));
    return;
  }
  box("what now", [
    "",
    opts.hold
      ? `${c.hi("y")}  ${c.white(`move the ${safe.length} safe items to the holding area`)}  ${c.hi(formatSize(sum(safe)))}  ${c.gray("undoable")}`
      : `${c.hi("y")}  ${c.white(`delete the ${safe.length} safe items now`)}  ${c.hi(formatSize(sum(safe)))}  ${c.gray("permanent")}`,
    `${c.amber("n")}  ${c.white("remove nothing, write a removal script to your Desktop")}`,
    `   ${c.gray("cleaner-remove.ps1 + .bat, running it later is your call")}`,
    "",
  ]);
  const yes = await askKey(`\n  ${c.hi(">")} ${c.white(opts.hold ? "move them now?" : "delete now?")} ${c.gray("[y/N]")} `);
  console.log();
  if (yes) {
    await removeEntries(safe, { header, entries, dbFile, hold: opts.hold });
    const left = entries.filter((e) => e.status === "pending" && e.verdict === "review").length;
    if (left) {
      console.log();
      console.log(`  ${c.gray(`${left} your-call items were left alone. Pick them with`)} ${c.hi("cleaner clean")}${c.gray(", or get a script with")} ${c.hi("cleaner export")}${c.gray(".")}`);
    }
    console.log();
  } else {
    announceScript(writeRemovalScript(entries, { dir: outDir(), roots }));
  }
}

const ADVICE = {
  reclaim: (t) => c.hi(t),
  check: (t) => c.amber(t),
  keep: (t) => c.gray(t),
};

async function runMap(args, opts) {
  const root = path.resolve(args[0] ?? path.parse(os.homedir()).root);
  if (!fs.existsSync(root)) throw new Error(`folder not found: ${root}`);

  banner(VERSION);
  applyPolicy(opts);
  const { useAi, apiKey, models } = geminiSetup(opts);
  if (useAi) logLine("info", "privacy", "only folder names and sizes go to gemini");
  logLine("ok", "target", shortPath(root));
  console.log();

  const started = Date.now();
  const task = new Task("sizing folders").animate();
  const result = await spaceMap(root, {
    onProgress: (p) => task.update(c.gray(truncateMiddle(`${p.files.toLocaleString()} files  ${formatSize(p.bytes)}  ${shortPath(p.current)}`, detailRoom()))),
  });
  const { stats } = result;
  task.done(`${stats.files.toLocaleString()} files, ${stats.dirs.toLocaleString()} folders, ${formatSize(stats.bytes)} in ${seconds(Date.now() - started)}`);
  if (stats.errors) logLine("info", "unreadable", `${stats.errors} folders need admin rights and were skipped`);

  // A folder must hold 2% of what was mapped to stand out (at least 1 MB, never more than 512 MB).
  const minBytes = Math.min(512 * 1024 ** 2, Math.max(1024 ** 2, stats.bytes * 0.02));
  const units = pickUnits(result, { minBytes, limit: opts.top ?? 15 });
  let explained = new Map();
  if (useAi && units.length) {
    const ai = new Task("gemini explains").animate();
    const gemini = new Gemini({ apiKey, models });
    const { results, error } = await explainFolders(units, { gemini });
    explained = results;
    if (error) ai.done(`no explanations: ${error.message}`, "warn");
    else ai.done(`${results.size} folders explained, ${[...gemini.used].join(", ")}`);
  }
  console.log();

  let disk = null;
  try {
    const s = fs.statfsSync(path.parse(root).root);
    disk = { total: s.blocks * s.bsize, free: s.bavail * s.bsize };
  } catch {
    // not available, skip the disk line
  }
  const shown = sum(units);
  const lines = [];
  if (disk) {
    const used = disk.total - disk.free;
    lines.push(`${c.gray("drive".padEnd(10))} ${c.white(`${path.parse(root).root}  ${formatSize(used)} used of ${formatSize(disk.total)}, ${formatSize(disk.free)} free`)}`);
    lines.push(`${" ".repeat(11)}${bar(used / disk.total, 44)}`);
  }
  lines.push(`${c.gray("mapped".padEnd(10))} ${c.white(`${formatSize(stats.bytes)} under ${truncateMiddle(shortPath(root), 40)}`)}`);
  lines.push(`${c.gray("top".padEnd(10))} ${c.white(`${units.length} folders hold ${formatSize(shown)}`)}`);
  box("space map", lines);
  console.log();

  if (!units.length) {
    console.log(`  ${c.gray("No single folder is big enough to stand out.")}\n`);
    return;
  }
  rule("where your space goes");
  const width = columns();
  units.forEach((u, i) => {
    const ex = explained.get(i + 1);
    const where = shortPath(u.path) + (u.loose ? "  (files directly inside)" : "");
    console.log(`  ${c.dim(String(i + 1).padStart(2, "0"))}  ${c.white(formatSize(u.size).padStart(9))}  ${bar(u.size / units[0].size, 12)}  ${c.gray(truncateMiddle(where, Math.max(20, width - 33)))}`);
    if (ex) {
      const advice = (ADVICE[ex.advice] ?? c.gray)(ex.advice);
      console.log(`  ${" ".repeat(15)}${c.white(truncateEnd(ex.label, 48))}${c.faint(" :: ")}${c.mid(ex.kind)}${c.faint(" :: ")}${advice}`);
      console.log(`  ${" ".repeat(15)}${c.faint("└─")} ${c.dim(truncateEnd(ex.tip, Math.max(20, width - 21)))}`);
    } else if (u.children.length) {
      console.log(`  ${" ".repeat(15)}${c.faint("└─")} ${c.dim(truncateEnd(u.children.map((ch) => `${ch.name} ${formatSize(ch.size)}`).join(", "), Math.max(20, width - 21)))}`);
    }
  });
  console.log();
  console.log(`  ${c.gray("Nothing was changed. Hunt junk inside a folder with")} ${c.hi("cleaner scan <folder>")}${c.gray(".")}\n`);
}

const CASING = { title: "Title Case", lower: "lower case", upper: "UPPER CASE", kebab: "kebab-case", snake: "snake_case", pascal: "PascalCase", sentence: "Sentence case", natural: "natural" };

async function runOrganize(args, opts) {
  const root = path.resolve(args[0] ?? desktopDir());
  banner(VERSION);
  const blocked = organizeBlocked(root);
  if (blocked) throw new Error(`${shortPath(root)}: ${blocked}`);
  applyPolicy(opts);
  const { useAi, apiKey, models } = geminiSetup(opts);
  if (useAi) logLine("info", "privacy", "only file names, sizes and dates go to gemini");
  logLine("ok", "target", shortPath(root));

  const analysis = analyzeFolder(root, { systemLocale: Intl.DateTimeFormat().resolvedOptions().locale });
  const { style } = analysis;
  const language = LANGUAGE_NAMES[style.language];
  if (style.detected) logLine("ok", "your style", `${language}, ${CASING[style.casing] ?? style.casing}${style.numbering ? ", numbered" : ""}, from ${analysis.folders.length} folders`);
  else logLine("info", "your style", `none found yet, basic folders in ${language} (${style.languageSource === "system" ? "your Windows language" : "default"})`);
  if (!analysis.files.length) {
    logLine("ok", "tidy", "no loose files to organize here");
    console.log();
    return;
  }

  let plan = rulePlan(analysis);
  if (useAi) {
    const task = new Task("gemini plans").animate();
    try {
      plan = await aiPlan(analysis, plan, { gemini: new Gemini({ apiKey, models }) });
      task.done(`${plan.moves.filter((m) => m.source === "gemini").length} files placed by gemini`);
    } catch (err) {
      task.done(`kept the local plan: ${err.message}`, "warn");
    }
  }
  console.log();

  const byId = new Map(analysis.files.map((f) => [f.id, f]));
  const groups = new Map();
  for (const m of plan.moves) {
    if (!groups.has(m.folder)) groups.set(m.folder, { isNew: m.isNew, files: [] });
    groups.get(m.folder).files.push(byId.get(m.id));
  }
  const ordered = [...groups].sort((a, b) => b[1].files.length - a[1].files.length);
  const width = columns();
  rule("the plan");
  for (const [folder, g] of ordered) {
    console.log(`  ${c.hi("->")} ${c.white(truncateEnd(folder, 40))}${g.isNew ? c.amber("  new") : c.faint("  existing")}  ${c.gray(`${g.files.length} file${g.files.length === 1 ? "" : "s"}, ${formatSize(sum(g.files))}`)}`);
    const names = g.files.map((f) => f.name);
    const shown = names.slice(0, 4).join(", ") + (names.length > 4 ? `, and ${names.length - 4} more` : "");
    console.log(`     ${c.faint("└─")} ${c.dim(truncateEnd(shown, Math.max(20, width - 10)))}`);
  }
  if (plan.stay.length) console.log(`  ${c.faint("·")}  ${c.gray(`${plan.stay.length} file${plan.stay.length === 1 ? "" : "s"} with no obvious place stay${plan.stay.length === 1 ? "s" : ""} where ${plan.stay.length === 1 ? "it is" : "they are"}`)}`);
  if (analysis.skipped.length) console.log(`  ${c.faint("·")}  ${c.gray(`${analysis.skipped.length} left alone: shortcuts, hidden or busy files are never moved`)}`);
  console.log();

  if (!plan.moves.length) {
    logLine("ok", "tidy", "everything already has its place");
    console.log();
    return;
  }
  if (opts.dryRun) {
    logLine("ok", "dry run", "nothing was moved");
    console.log();
    return;
  }
  const newFolders = ordered.filter(([, g]) => g.isNew).length;
  const yes = await askKey(`  ${c.hi(">")} ${c.white(`move ${plan.moves.length} files into ${groups.size} folders${newFolders ? ` (${newFolders} new)` : ""}?`)} ${c.gray("[y/N]")} `);
  console.log();
  if (!yes) {
    logLine("ok", "cancelled", "nothing was moved");
    console.log();
    return;
  }
  const journal = applyPlan(analysis, plan.moves);
  audit("organize", { root, items: journal.moves.map((m) => ({ path: m.from, to: m.to, size: m.size })), run: journal.id });
  logLine(journal.failed.length ? "warn" : "ok", "organized", `${journal.moves.length} files moved, ${journal.createdFolders.length} folders created`);
  for (const f of journal.failed) logLine("skip", f.reason, shortPath(f.path));
  console.log();
  console.log(`  ${c.gray("Changed your mind? Put everything back with")} ${c.hi("cleaner organize --undo")}${c.gray(".")}
`);
}

async function runOrganizeUndo() {
  banner(VERSION);
  const last = listJournals().find((j) => !j.undoneAt && j.moves.length);
  if (!last) {
    logLine("ok", "organize", "no organize run to undo");
    console.log();
    return;
  }
  logLine("info", "last run", `${shortPath(last.root)}, ${new Date(last.time).toLocaleString()}`);
  const yes = await askKey(`  ${c.hi(">")} ${c.white(`move ${last.moves.length} files back where they were?`)} ${c.gray("[y/N]")} `);
  console.log();
  if (!yes) {
    logLine("ok", "cancelled", "nothing was moved");
    console.log();
    return;
  }
  const r = undoOrganize(last.id);
  audit("organize-undo", { root: last.root, items: last.moves.map((m) => ({ path: m.from, size: m.size })), run: last.id });
  logLine(r.skipped.length ? "warn" : "ok", "undone", `${r.restored} of ${last.moves.length} files are back`);
  for (const s of r.skipped) logLine("skip", s.reason, shortPath(s.path));
  console.log();
}

async function runClean(opts) {
  const dbFile = opts.db ?? DEFAULTS.db;
  const { header, entries } = readDb(dbFile);
  banner(VERSION);
  applyPolicy(opts);
  if (opts.hold) logLine("info", "mode", "hold: items are moved aside, nothing is deleted");
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
    logLine("ok", "nothing", "no items selected, nothing removed");
    console.log();
    return;
  }
  if (opts.dryRun) {
    for (const e of selected) logLine("info", "would remove", `${formatSize(e.size).padStart(9)}  ${shortPath(e.path)}`);
    logLine("ok", "dry run", "nothing was removed");
    console.log();
    return;
  }
  const verb = opts.hold ? "move" : "delete";
  const how = opts.hold ? "to the holding area" : "permanently";
  const yes = await askKey(`  ${c.hi(">")} ${c.white(`${verb} ${selected.length} items, ${formatSize(sum(selected))}, ${how}?`)} ${c.gray("[y/N]")} `);
  console.log();
  if (!yes) {
    logLine("ok", "cancelled", "nothing was removed");
    console.log();
    return;
  }
  await removeEntries(selected, { header, entries, dbFile, hold: opts.hold });
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
  announceScript(writeRemovalScript(entries, { dir: opts.out ?? desktopDir(), roots: scanned }));
}

function printHeld(held) {
  for (const h of held) console.log(`  ${c.white(formatSize(h.size).padStart(9))}  ${c.gray(truncateMiddle(shortPath(h.original), columns() - 15))}`);
}

async function runRestore() {
  banner(VERSION);
  const held = listHeld();
  if (!held.length) {
    logLine("ok", "holding area", "empty, nothing to restore");
    console.log();
    return;
  }
  rule("holding area");
  printHeld(held);
  console.log();
  const yes = await askKey(`  ${c.hi(">")} ${c.white(`put all ${held.length} items back, ${formatSize(sum(held))}?`)} ${c.gray("[y/N]")} `);
  console.log();
  if (!yes) {
    logLine("ok", "cancelled", "nothing was moved");
    console.log();
    return;
  }
  const r = restoreHeld(held);
  const result = (h) => (r.restored.includes(h) ? "restored" : r.conflicts.includes(h) ? "conflict" : "failed");
  audit("restore", { items: held.map((h) => ({ path: h.original, size: h.size, result: result(h) })) });
  logLine(r.failed.length || r.conflicts.length ? "warn" : "ok", "restored", `${r.restored.length} of ${held.length} items are back`);
  for (const h of r.conflicts) logLine("skip", "already there", shortPath(h.original));
  for (const h of r.failed) logLine("fail", "not moved", shortPath(h.original));
  console.log();
}

async function runPurge() {
  banner(VERSION);
  const held = listHeld();
  if (!held.length) {
    logLine("ok", "holding area", "empty, nothing to purge");
    console.log();
    return;
  }
  rule("holding area");
  printHeld(held);
  console.log();
  const yes = await askKey(`  ${c.hi(">")} ${c.white(`delete all ${held.length} held items for good, ${formatSize(sum(held))}?`)} ${c.gray("[y/N]")} `);
  console.log();
  if (!yes) {
    logLine("ok", "cancelled", "nothing was deleted");
    console.log();
    return;
  }
  const before = freeBytes(HOLD_DIR);
  const r = purgeHeld(held);
  audit("purge", { items: held.map((h) => ({ path: h.original, size: h.size, result: r.purged.includes(h) ? "purged" : "failed" })) });
  const after = freeBytes(HOLD_DIR);
  logLine(r.failed.length ? "warn" : "ok", "purged", `${r.purged.length} of ${held.length} items deleted`);
  for (const h of r.failed) logLine("fail", "still there", shortPath(h.held));
  if (before !== null && after !== null) logLine("ok", "disk", `${formatSize(Math.max(0, after - before))} reclaimed, ${formatSize(after)} free now`);
  console.log();
}

async function runSetup() {
  banner(VERSION);
  logLine("info", "settings", shortPath(ENV_FILES[0]));
  logLine("info", "free key", "aistudio.google.com/apikey");
  console.log();
  const key = await askLine(`  ${c.hi(">")} ${c.white("gemini api key")} ${c.gray("(Enter to skip)")} `);
  console.log();
  if (!key) {
    logLine("skip", "gemini", "no key saved, cleaner uses local rules only");
    console.log();
    return;
  }
  const task = new Task("checking key").animate();
  const check = await Gemini.checkKey(key);
  if (!check.ok) {
    task.done(`rejected: ${check.message}`, "fail");
    console.log();
    process.exitCode = 1;
    return;
  }
  task.done("key works");
  logLine("ok", "saved", shortPath(saveSetting("GEMINI_API_KEY", key)));
  console.log();
}

export async function main(argv) {
  try {
    const { cmd, args, opts } = parseArgs(argv);
    if (cmd === "version") {
      console.log(VERSION);
      return;
    }
    if (cmd === "help") {
      help();
      return;
    }
    if (process.platform !== "win32") throw new Error("cleaner runs on Windows only for now");
    loadEnv();
    migrateOldDb();
    if (cmd === "map") await runMap(args, opts);
    else if (cmd === "organize") await (opts.undo ? runOrganizeUndo() : runOrganize(args, opts));
    else if (cmd === "list") runList(opts);
    else if (cmd === "export") runExport(opts);
    else if (cmd === "clean") await runClean(opts);
    else if (cmd === "restore") await runRestore();
    else if (cmd === "purge") await runPurge();
    else if (cmd === "setup") await runSetup();
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
