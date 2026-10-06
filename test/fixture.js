// Builds a fake user folder full of junk and traps. Everything in it is made up.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const KB = 1024;
const MB = 1024 * KB;
const DAY = 86_400_000;

export function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cleaner-test-"));
  const file = (rel, { size = KB, head = "", ageDays = 0, text = null } = {}) => {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    let buf;
    if (text !== null) {
      buf = Buffer.from(text.repeat(Math.max(1, Math.ceil(size / text.length))).slice(0, Math.max(size, text.length)));
    } else {
      buf = Buffer.alloc(size, 7);
      Buffer.from(head, "latin1").copy(buf, 0);
    }
    fs.writeFileSync(p, buf);
    const t = new Date(Date.now() - ageDays * DAY);
    fs.utimesSync(p, t, t);
    return p;
  };

  file("Downloads/Unconfirmed 4821.crdownload", { size: 2 * MB, ageDays: 40 });
  file("Downloads/Rapport d'été 🎵.crdownload", { size: 1 * MB, ageDays: 12 });
  file("Downloads/tool-setup.exe", { size: 2 * MB, head: "MZ", ageDays: 30 });
  file("Downloads/tool-setup (1).exe", { size: 2 * MB, head: "MZ", ageDays: 29 });
  file("Downloads/trip.zip", { size: 2 * MB, head: "PK\x03\x04", ageDays: 60 });
  file("Downloads/trip/IMG_0001.jpg", { size: 100 * KB, head: "\xff\xd8\xff" });
  file("Documents/thesis-draft.txt", { size: 1.5 * MB, ageDays: 3, text: "Chapter 2. My own notes for the thesis defense. " });
  file("Documents/server_creds.txt", { size: 2 * KB, ageDays: 90, text: "password=hunter2\n" });
  file("Documents/~$thesis.docx", { size: 162, ageDays: 5 });
  file("Pictures/dinner.jpg", { size: 2 * MB, head: "\xff\xd8\xff", ageDays: 200 });
  file("Pictures/Backup/dinner.jpg", { size: 2 * MB, head: "\xff\xd8\xff", ageDays: 100 });
  file("Videos/edit.mp4", { size: 2 * MB, head: "\0\0\0\x18ftypmp42", ageDays: 50 });
  file("Videos/old/edit.mp4", { size: 2 * MB, head: "\0\0\0\x18ftypmp42", ageDays: 49 });
  file("projects/site/package.json", { text: "{}", size: 2 });
  for (let i = 0; i < 5; i++) file(`projects/site/node_modules/pkg${i}/index.js`, { size: 10 * KB });
  file("projects/site/.next/cache/pack", { size: 100 * KB });
  file("projects/site/.git/objects/pack/p.pack", { size: 3 * MB });
  file("projects/ml/.venv/pyvenv.cfg", { text: "home = C:\\Python\n", size: 10 });
  file("projects/ml/.venv/Lib/x.py", { size: 50 * KB });
  file("projects/ml/__pycache__/m.pyc", { size: 20 * KB });
  file("AppData/Roaming/npm/node_modules/some-cli/index.js", { size: 2 * MB });
  file("AppData/Local/Editor/Apps/1.0.0/editor.dll", { size: 1 * MB, head: "MZ", ageDays: 300 });
  file("AppData/Local/Editor/Apps/1.2.0/editor.dll", { size: 1 * MB, head: "MZ", ageDays: 10 });
  file("AppData/Local/Editor/User Data/Cache/data_1", { size: 51 * MB, ageDays: 2 });
  file("AppData/Local/Temp/installer.tmp", { size: 2 * MB, ageDays: 20 });
  file("AppData/Local/CrashDumps/game.dmp", { size: 1 * MB, ageDays: 15 });
  fs.symlinkSync(root, path.join(root, "projects", "loop"), "junction");

  // Traps found on a real PC: installed tools, game copies, project assets, non-download .part files,
  // and a stray program sitting in the folder being scanned (it must not make the whole scan "an app").
  file("cloudflared.exe", { size: 4 * KB, head: "MZ" });
  file("package.json", { text: "{}", size: 2 });
  file(".vscode/extensions/pub.ext-1.0.0/package.json", { text: "{}", size: 2 });
  file(".vscode/extensions/pub.ext-1.0.0/node_modules/dep/index.js", { size: 50 * KB });
  file(".cache/tool/__pycache__/x.pyc", { size: 20 * KB });
  file("Games/Omori/Game.exe", { size: 4 * KB, head: "MZ" });
  file("Games/Omori/www/movie.webm", { size: 2 * MB, head: "\x1a\x45\xdf\xa3" });
  file("Games/Omori copy/Game.exe", { size: 4 * KB, head: "MZ" });
  file("Games/Omori copy/www/movie.webm", { size: 2 * MB, head: "\x1a\x45\xdf\xa3" });
  file("code/a/package.json", { text: "{}", size: 2 });
  file("code/a/public/hero.png", { size: 2 * MB, head: "\x89PNG" });
  file("code/b/package.json", { text: "{}", size: 2 });
  file("code/b/public/hero.png", { size: 2 * MB, head: "\x89PNG" });
  file("Downloads/hero.png", { size: 2 * MB, head: "\x89PNG", ageDays: 5 });
  file("Data/chunks/archive.part", { size: 2 * KB, ageDays: 30 });
  file("Downloads/movie.part", { size: 2 * KB, ageDays: 30 });
  file("AppData/Roaming/.minecraft/versions/1.20.1/1.20.1.jar", { size: 10 * KB });
  file("AppData/Roaming/.minecraft/versions/1.21/1.21.jar", { size: 10 * KB });
  file("AppData/Local/Discord/app-1.0.9237/Discord.exe", { size: 10 * KB, head: "MZ" });
  file("AppData/Local/Discord/app-1.0.9238/Discord.exe", { size: 10 * KB, head: "MZ" });
  return root;
}

export const at = (root, rel) => path.join(root, ...rel.split("/"));
