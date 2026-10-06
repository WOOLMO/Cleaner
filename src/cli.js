import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadEnv, saveSetting, migrateOldDb, DEFAULTS, DATA_DIR, ENV_FILES, ROOT } from "./config.js";
import { scan } from "./scan.js";
import { spaceMap, pickUnits } from "./map.js";
import { inspectFile } from "./inspect.js";
import { Gemini, classifyItems, explainFolders } from "./gemini.js";
import { decide } from "./decide.js";
import { makeHeader, writeDb, readDb } from "./db.js";
import { isSafeToRemove, removePermanently, freeBytes } from "./remove.js";
import { holdItems, listHeld, restoreHeld, purgeHeld, HOLD_DIR } from "./hold.js";
import { writeRemovalScript, desktopDir } from "./script.js";
import { askKey, askLine, closeInput } from "./input.js";
import {
  c, banner, logLine, Task, box, bar, rule, verdictTag, columns, detailRoom,
  formatSize, shortPath, truncateMiddle, truncateEnd,
} from "./ui.js";

const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
const COMMANDS = ["scan", "map", "clean", "list", "export", "restore", "purge", "setup", "help"];
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
  line("--dry-run", "with clean: list, remove nothing");
  console.log();
  console.log(`  ${c.gray("data folder")}  ${c.dim(shortPath(DATA_DIR))}`);
  console.log();
}

function geminiSetup(opts) {
  const apiKey = process.env.GEMINI_API_KEY;
  const models = opts.model
    ? [opts.model, ...DEFAULTS.models.filter((m) => m !== opts.model)]
    : (process.env.GEMINI_MODELS?.split(",").map((s) => s.trim()).filter(Boolean) ?? DEFAULTS.models);
  const useAi = !opts.offline && Boolean(apiKey) && opts.maxAi !== 0;
  if (opts.offline) logLine("skip", "gemini", "--offline, local rules only");
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
  const { useAi, apiKey, models } = geminiSetup(opts);
  if (useAi) logLine("info", "privacy", opts.noContent ? "names, sizes and dates go to gemini" : "names, sizes, dates and masked previews go to gemini");
  if (opts.hold) logLine("info", "mode", "hold: y moves items aside, nothing is deleted");
  for (const r of roots) logLine("ok", "target", shortPath(r));
  console.log();

  // 1. walk + duplicates
  const started = Date.now();
  const walkTask = new Task("walking disk").animate();
  let hashTask = null;
  let walked = null;
  const { items, stats } = await scan(roots, {
    largeFileMB: opts.largeMB ?? DEFAULTS.largeFileMB,
    dupeMinMB: DEFAULTS.dupeMinMB,
    exclude: opts.exclude,
    onProgress: (ev) => {
      if (ev.type === "walk") {
        walkTask.update(c.gray(truncateMiddle(`${ev.files.toLocaleString()} files  ${formatSize(ev.bytes)}  ${shortPath(ev.current)}`, detailRoom())));
      } else if (ev.type === "walked") {
        walked = ev;
        walkTask.done(`${ev.files.toLocaleString()} files, ${ev.dirs.toLocaleString()} folders, ${formatSize(ev.bytes)} in ${seconds(ev.ms)}`);
      } else if (ev.type === "hash") {
        hashTask ??= new Task("hashing copies").animate();
        hashTask.update(`${bar(ev.done / ev.total, 16)} ${c.gray(`${formatSize(ev.done)} / ${formatSize(ev.total)}`)}`);
      }
    },
  });
  if (!walked) walkTask.done(`${stats.files.toLocaleString()} files, ${formatSize(stats.bytes)}`);
  const dupes = items.filter((i) => i.category === "duplicate").length;
  if (hashTask) hashTask.done(`${dupes} byte-identical copies`);
  else logLine("ok", "hashing copies", `${dupes} byte-identical copies`);

  // 2. look inside the files
  const files = items.filter((i) => i.kind === "file");
  const inspect = new Task("reading content");
  files.forEach((item, n) => {
    inspect.update(c.gray(truncateMiddle(`${n + 1}/${files.length}  ${shortPath(item.path)}`, detailRoom())));
    Object.assign(item, inspectFile(item.path, item.size, { allowPreview: useAi && !opts.noContent && item.verdict !== "remove" }));
  });
  inspect.done(`${files.length} files sniffed, ${files.filter((f) => f.preview).length} previews, ${files.filter((f) => f.sensitive).length} look sensitive`);

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
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  writeDb(dbFile, header, entries);
  logLine("ok", "database", shortPath(dbFile));
  console.log();

  reportBox(entries, { roots, stats, elapsed: Date.now() - started, candidates: items.length, checked, model, leftOut });
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

async function runClean(opts) {
  const dbFile = opts.db ?? DEFAULTS.db;
  const { header, entries } = readDb(dbFile);
  banner(VERSION);
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
