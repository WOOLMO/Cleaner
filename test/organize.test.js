import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "cleaner-org-"));
process.env.CLEANER_HOME = path.join(sandbox, "data");
const {
  caseOf, categoryOf, detectLanguage, detectStyle, styleName, analyzeFolder, rulePlan, aiPlan,
  applyPlan, undoOrganize, listJournals, cleanFolderName, organizeBlocked,
} = await import("../src/organize.js");

after(() => fs.rmSync(sandbox, { recursive: true, force: true }));

const OLD = Date.now() - 86_400_000;
function folder(name, files = {}, dirs = []) {
  const root = path.join(sandbox, name);
  fs.mkdirSync(root, { recursive: true });
  for (const d of dirs) fs.mkdirSync(path.join(root, d), { recursive: true });
  for (const [rel, body] of Object.entries(files)) {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
    fs.utimesSync(p, OLD / 1000, OLD / 1000);
  }
  return root;
}

test("file kinds come from the extension, screenshots from the name", () => {
  assert.equal(categoryOf("report.PDF"), "documents");
  assert.equal(categoryOf("Screenshot 2026-01-02.png"), "screenshots");
  assert.equal(categoryOf("Capture d’écran 2026.png"), "screenshots");
  assert.equal(categoryOf("holiday.jpg"), "images");
  assert.equal(categoryOf("setup.msi"), "installers");
  assert.equal(categoryOf("notes.weird"), null);
});

test("naming styles are recognised", () => {
  assert.equal(caseOf("Coding Projects"), "title");
  assert.equal(caseOf("YouTube Channel"), "title");
  assert.equal(caseOf("coding projects"), "lower");
  assert.equal(caseOf("coding-projects"), "kebab");
  assert.equal(caseOf("coding_projects"), "snake");
  assert.equal(caseOf("CodingProjects"), "pascal");
  assert.equal(caseOf("Mes projets perso"), "sentence");
  assert.equal(caseOf("01 - Work"), "capitalized");
});

test("the language comes from folder names before the system", () => {
  assert.equal(detectLanguage(["Coding Projects", "Games", "Apps and Installers", "Important Later"], "fr-FR").language, "en");
  assert.equal(detectLanguage(["Mes projets", "Factures", "Jeux", "Cours"], "en-US").language, "fr");
  assert.equal(detectLanguage(["مستندات", "صور"], "en-US").language, "ar");
  const fallback = detectLanguage(["xyz", "abc"], "de-DE");
  assert.deepEqual(fallback, { language: "de", source: "system" });
  assert.equal(detectLanguage([], "").language, "en");
});

test("new folder names follow the owner's language and casing", () => {
  assert.equal(styleName("images", { language: "en", casing: "title" }), "Images");
  assert.equal(styleName("disk-images", { language: "en", casing: "lower" }), "disk images");
  assert.equal(styleName("screenshots", { language: "fr", casing: "kebab" }), "captures-décran");
  assert.equal(styleName("audio", { language: "fr", casing: "title" }), "Musique");
  assert.equal(styleName("3d", { language: "en", casing: "pascal" }), "3DModels");
  const numbered = { language: "en", casing: "title", numbering: { width: 2, separator: " - ", next: 4 } };
  assert.equal(styleName("videos", numbered), "04 - Videos");
  assert.equal(styleName("audio", numbered, new Set(["04 - Videos"])), "05 - Music");
});

test("style detection reports when there is no style to follow", () => {
  const none = detectStyle([], "fr-FR");
  assert.equal(none.detected, false);
  assert.equal(none.language, "fr");
  const titled = detectStyle(["Coding Projects", "YouTube Channel", "Important Later", "Games"], "fr-FR");
  assert.equal(titled.detected, true);
  assert.equal(titled.casing, "title");
  assert.equal(titled.language, "en");
});

test("folder names from anywhere are cleaned or refused", () => {
  assert.equal(cleanFolderName("Invoices 2026"), "Invoices 2026");
  assert.equal(cleanFolderName("a/b"), "ab");
  assert.equal(cleanFolderName("..\\..\\Windows"), "Windows");
  assert.equal(cleanFolderName("CON"), null);
  assert.equal(cleanFolderName("   "), null);
  assert.equal(cleanFolderName(42), null);
});

test("existing folders are reused, missing kinds get new folders in the owner's style", () => {
  const root = folder("desk", {
    "Wallpapers/a.jpg": "x", "Wallpapers/b.png": "x", "Wallpapers/c.jpg": "x",
    "Apps and Installers/old.exe": "x",
    "Coding Projects/site/package.json": "{}", "Coding Projects/site/index.js": "x",
    "beach.jpg": "x", "Screenshot 1.png": "x", "Setup.exe": "x", "cv.pdf": "x", "song.mp3": "x",
    "Notes.lnk": "x", ".hidden": "x", "thing.unknown": "x",
  }, ["Games", "Important Later"]);
  const analysis = analyzeFolder(root, { systemLocale: "fr-FR" });
  assert.equal(analysis.style.language, "en");
  assert.equal(analysis.style.casing, "title");
  assert.deepEqual(analysis.skipped.map((s) => s.name).sort(), [".hidden", "Notes.lnk"]);
  const plan = rulePlan(analysis);
  const to = (name) => plan.moves.find((m) => analysis.files.find((f) => f.id === m.id).name === name);
  assert.equal(to("beach.jpg").folder, "Wallpapers");
  assert.equal(to("beach.jpg").isNew, false);
  assert.equal(to("Screenshot 1.png").folder, "Wallpapers"); // no screenshots folder, images folder takes them
  assert.equal(to("Setup.exe").folder, "Apps and Installers");
  assert.equal(to("cv.pdf").folder, "Documents");
  assert.equal(to("cv.pdf").isNew, true);
  assert.equal(to("song.mp3").folder, "Music");
  assert.deepEqual(plan.stay.map((s) => s.name), ["thing.unknown"]);
});

test("a file whose name matches one of the owner's folders goes there", () => {
  const root = folder("purpose", { "facture-edf.pdf": "x", "cours-algebre.docx": "x", "notes.txt": "x", "copy.pdf": "x" }, ["Cours de maths", "Factures", "Mes projets"]);
  const analysis = analyzeFolder(root, { systemLocale: "en-US" });
  const plan = rulePlan(analysis);
  const to = (name) => plan.moves.find((m) => analysis.files.find((f) => f.id === m.id).name === name).folder;
  assert.equal(to("facture-edf.pdf"), "Factures");
  assert.equal(to("cours-algebre.docx"), "Cours de maths");
  assert.equal(to("notes.txt"), "Documents");
  assert.equal(to("copy.pdf"), "Documents");
});

test("files changed moments ago are left alone", () => {
  const root = folder("fresh", { "old.pdf": "x" });
  fs.writeFileSync(path.join(root, "new.pdf"), "x");
  const analysis = analyzeFolder(root);
  assert.deepEqual(analysis.files.map((f) => f.name), ["old.pdf"]);
  assert.equal(analysis.skipped[0].reason, "changed in the last two minutes");
});

test("Gemini can rename and regroup, but bad names fall back to the rules", async () => {
  const root = folder("ai", { "facture-edf-mars.pdf": "x", "facture-free.pdf": "x", "photo.jpg": "x", "clip.mp4": "x" }, ["Mes projets", "Factures", "Jeux"]);
  const analysis = analyzeFolder(root, { systemLocale: "fr-FR" });
  assert.equal(analysis.style.language, "fr");
  const base = rulePlan(analysis);
  const id = (name) => analysis.files.find((f) => f.name === name).id;
  const gemini = {
    generate: async (body) => {
      assert.ok(!JSON.stringify(body).includes(root), "paths never go to gemini");
      return {
        results: [
          { id: id("facture-edf-mars.pdf"), folder: "factures", reason: "Facture" },
          { id: id("facture-free.pdf"), folder: "Factures", reason: "Facture" },
          { id: id("photo.jpg"), folder: "CON", reason: "bad name" },
          { id: id("clip.mp4"), folder: "", reason: "Leave it" },
        ],
      };
    },
  };
  const plan = await aiPlan(analysis, base, { gemini });
  const move = (name) => plan.moves.find((m) => m.id === id(name));
  assert.equal(move("facture-edf-mars.pdf").folder, "Factures"); // matched to the existing folder's spelling
  assert.equal(move("facture-edf-mars.pdf").isNew, false);
  assert.equal(move("photo.jpg").source, "rules");
  assert.equal(move("photo.jpg").folder, "Images");
  assert.ok(plan.stay.some((s) => s.id === id("clip.mp4")));
});

test("applying moves files without overwriting, and undo puts everything back", () => {
  const root = folder("apply", { "a.pdf": "new", "b.jpg": "x", "Documents/a.pdf": "already here" });
  const analysis = analyzeFolder(root);
  const plan = rulePlan(analysis);
  const journal = applyPlan(analysis, [...plan.moves, { id: 999, folder: "Nope" }, { id: analysis.files[0].id, folder: "..\\..\\escape" }]);
  assert.equal(journal.moves.length, 2);
  assert.equal(fs.readFileSync(path.join(root, "Documents", "a.pdf"), "utf8"), "already here");
  assert.equal(fs.readFileSync(path.join(root, "Documents", "a (2).pdf"), "utf8"), "new");
  assert.ok(fs.existsSync(path.join(root, "Images", "b.jpg")));
  assert.ok(!fs.existsSync(path.join(sandbox, "escape")));
  assert.equal(listJournals()[0].id, journal.id);

  const undo = undoOrganize(journal.id);
  assert.equal(undo.restored, 2);
  assert.equal(fs.readFileSync(path.join(root, "a.pdf"), "utf8"), "new");
  assert.ok(fs.existsSync(path.join(root, "b.jpg")));
  assert.ok(!fs.existsSync(path.join(root, "Images")), "folders it created are removed when empty");
  assert.ok(fs.existsSync(path.join(root, "Documents", "a.pdf")), "folders that were there stay");
  assert.ok(listJournals()[0].undoneAt);
});

test("drives, system folders and code projects are refused", () => {
  assert.match(organizeBlocked("C:\\"), /drive/);
  if (process.env.SystemRoot) assert.match(organizeBlocked(process.env.SystemRoot), /system/);
  assert.match(organizeBlocked(sandbox, { systemDirs: [os.tmpdir()] }), /system/);
  const project = folder("proj", { "package.json": "{}" });
  assert.match(organizeBlocked(project, { systemDirs: [] }), /code project/);
  assert.equal(organizeBlocked(folder("plain", { "a.txt": "x" }), { systemDirs: [] }), null);
  assert.match(organizeBlocked(path.join(sandbox, "missing")), /does not exist/);
});

test("the folder graph reads one level at a time and folds the rest", async () => {
  const { readGraph, readLevel, isInside } = await import("../src/graph.js");
  const files = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`f${String(i).padStart(2, "0")}.txt`, "x".repeat(i)]));
  const root = folder("graph", { ...files, "sub/a.jpg": "x", "sub/deeper/b.pdf": "x", "node_modules/x/index.js": "x" });
  const tree = readGraph(root);
  const sub = tree.children.find((n) => n.name === "sub");
  assert.equal(sub.kind, "dir");
  assert.equal(sub.count, 2);
  assert.ok(sub.partial && sub.children.some((n) => n.name === "a.jpg" && n.category === "images"));
  assert.ok(tree.children.find((n) => n.name === "node_modules").heavy);
  assert.equal(tree.children.find((n) => n.name === "node_modules").children, undefined, "heavy folders are not previewed");
  const more = tree.children.find((n) => n.kind === "more");
  assert.equal(more.files, 6);
  assert.equal(tree.children.filter((n) => n.kind === "file")[0].name, "f29.txt", "biggest files first");
  const flagged = readLevel(root, { flags: new Map([[path.join(root, "sub").toLowerCase(), "remove"]]) });
  assert.equal(flagged.children.find((n) => n.name === "sub").flag, "remove");
  assert.ok(isInside(root, path.join(root, "sub", "deeper")));
  assert.ok(!isInside(root, path.join(root, "..")));
  assert.ok(!isInside(root, root + "-evil"));
  const home = folder("home", { ".a/x": "x", ".b/x": "x", "AppData/x": "x", "Zeta/x": "x", "ntuser.dat": "x".repeat(100), "z.txt": "x" });
  const level = readLevel(home, { maxDirs: 2 });
  assert.deepEqual(level.children.filter((n) => n.kind === "dir").map((n) => n.name), ["Zeta", ".a"], "visible folders come before hidden ones");
  assert.equal(level.children.find((n) => n.name === ".a").hidden, true);
  assert.equal(level.children.find((n) => n.name === "z.txt").hidden, undefined);
  assert.equal(level.children.filter((n) => n.kind === "file")[0].name, "z.txt", "hidden files go last even when bigger");
});
