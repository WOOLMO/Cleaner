import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { makeFixture, at } from "./fixture.js";
import { scan } from "../src/scan.js";
import { treeSize } from "../src/walk.js";

let root;
let items;

before(async () => {
  root = makeFixture();
  ({ items } = await scan([root], { largeFileMB: 1 }));
});
after(() => fs.rmSync(root, { recursive: true, force: true }));

const item = (rel) => items.find((i) => i.path.toLowerCase() === at(root, rel).toLowerCase());
const anyUnder = (fragment) => items.some((i) => i.path.toLowerCase().includes(fragment.toLowerCase()));

test("unfinished downloads are safe to remove, including odd names", () => {
  assert.equal(item("Downloads/Unconfirmed 4821.crdownload")?.verdict, "remove");
  assert.equal(item("Downloads/Rapport d'été 🎵.crdownload")?.category, "partial-download");
});

test("node_modules next to a package.json is rebuildable", () => {
  const nm = item("projects/site/node_modules");
  assert.equal(nm?.verdict, "remove");
  assert.equal(nm?.kind, "dir");
  assert.equal(nm?.files, 5);
});

test("build output and bytecode caches are rebuildable", () => {
  assert.equal(item("projects/site/.next")?.verdict, "remove");
  assert.equal(item("projects/ml/__pycache__")?.verdict, "remove");
});

test("python virtual environments are your call", () => {
  assert.equal(item("projects/ml/.venv")?.verdict, "review");
});

test("global npm tools, .git folders and junction loops are never touched", () => {
  assert.equal(anyUnder("\\AppData\\Roaming\\npm\\"), false);
  assert.equal(anyUnder("\\.git\\"), false);
  assert.equal(anyUnder("\\loop\\"), false);
});

test("byte-identical copies: the original stays, the copy is flagged", () => {
  assert.equal(item("Downloads/tool-setup (1).exe")?.category, "duplicate");
  assert.equal(item("Downloads/tool-setup (1).exe")?.verdict, "remove");
  assert.notEqual(item("Downloads/tool-setup.exe")?.category, "duplicate");
  assert.equal(item("Videos/old/edit.mp4")?.category, "duplicate");
  assert.notEqual(item("Videos/edit.mp4")?.category, "duplicate");
});

test("a copy next to a Backup folder is your call, not safe", () => {
  assert.equal(item("Pictures/Backup/dinner.jpg")?.verdict, "review");
});

test("older app versions are your call and the newest is kept", () => {
  assert.equal(item("AppData/Local/Editor/Apps/1.0.0")?.verdict, "review");
  assert.equal(item("AppData/Local/Editor/Apps/1.2.0"), undefined);
});

test("app caches, temp files, crash dumps and Office lock files are safe", () => {
  assert.equal(item("AppData/Local/Editor/User Data/Cache")?.category, "app-cache");
  assert.equal(item("AppData/Local/Temp/installer.tmp")?.verdict, "remove");
  assert.equal(item("AppData/Local/CrashDumps/game.dmp")?.category, "crash-dump");
  assert.equal(item("Documents/~$thesis.docx")?.category, "temp-file");
});

test("an archive next to its extracted folder is your call", () => {
  assert.equal(item("Downloads/trip.zip")?.category, "extracted-archive");
  assert.equal(item("Downloads/trip.zip")?.verdict, "review");
});

test("personal files are never flagged by rules alone", () => {
  assert.equal(item("Documents/thesis-draft.txt")?.verdict, "unknown");
  assert.equal(item("Documents/server_creds.txt"), undefined);
  assert.equal(item("Pictures/dinner.jpg")?.verdict ?? "unknown", "unknown");
});

test("installed tools keep their own node_modules and caches", () => {
  assert.equal(anyUnder("\\.vscode\\"), false);
  assert.equal(anyUnder("\\.cache\\"), false);
});

test("copies inside game installs and projects are not duplicates", () => {
  const dupes = items.filter((i) => i.category === "duplicate").map((i) => i.path.toLowerCase());
  assert.equal(dupes.some((p) => p.includes("\\games\\omori")), false);
  assert.equal(dupes.some((p) => p.includes("\\code\\")), false);
});

test("a loose copy of a project file is flagged; the project's own copies are not", () => {
  const loose = item("Downloads/hero.png");
  assert.equal(loose?.category, "duplicate");
  assert.match(loose.duplicateOf, /\\code\\[ab]\\public\\hero\.png$/);
});

test(".part files only count where downloads land", () => {
  assert.equal(item("Downloads/movie.part")?.category, "partial-download");
  assert.equal(item("Data/chunks/archive.part"), undefined);
});

test("game version folders are not old app versions, self-updating apps are", () => {
  assert.equal(anyUnder("\\.minecraft\\"), false);
  assert.equal(item("AppData/Local/Discord/app-1.0.9237")?.category, "old-app-version");
  assert.equal(item("AppData/Local/Discord/app-1.0.9238"), undefined);
});

test("treeSize adds up a folder without following links", async () => {
  const t = await treeSize(at(root, "projects"));
  assert.ok(t.files >= 10);
  assert.ok(t.size < 4 * 1024 * 1024, "the junction back to the root must not be counted");
});
