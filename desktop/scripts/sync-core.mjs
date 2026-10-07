// Copies the shared engine (../src) into desktop/core so the app always ships the same code as the CLI.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const from = path.join(desktop, "..", "src");
const to = path.join(desktop, "core");

fs.rmSync(to, { recursive: true, force: true });
fs.mkdirSync(to, { recursive: true });
let n = 0;
for (const name of fs.readdirSync(from)) {
  if (!name.endsWith(".js")) continue;
  fs.copyFileSync(path.join(from, name), path.join(to, name));
  n++;
}
// The engine reads the version from package.json next to it; give it the CLI's.
fs.copyFileSync(path.join(desktop, "..", "package.json"), path.join(to, "engine-package.json"));
console.log(`synced ${n} engine modules into desktop/core`);
