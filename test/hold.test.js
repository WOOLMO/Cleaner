import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The holding area lives in CLEANER_HOME, so point it at a throwaway folder before loading the module.
const home = fs.mkdtempSync(path.join(os.tmpdir(), "cleaner-home-"));
process.env.CLEANER_HOME = home;
const { holdItems, listHeld, restoreHeld, purgeHeld, HOLD_DIR } = await import("../src/hold.js");

let work;
before(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), "cleaner-hold-"));
});
after(() => {
  fs.rmSync(work, { recursive: true, force: true });
  fs.rmSync(home, { recursive: true, force: true });
});

function makeItems() {
  const file = path.join(work, "old download.crdownload");
  const dir = path.join(work, "cache");
  fs.writeFileSync(file, "x".repeat(1000));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "data"), "y".repeat(500));
  return [
    { id: 1, path: file, size: 1000, status: "pending" },
    { id: 2, path: dir, size: 500, status: "pending" },
  ];
}

test("hold moves items aside and restore puts them back", () => {
  const items = makeItems();
  const { held } = holdItems(items);
  assert.equal(held, 2);
  assert.ok(items.every((e) => e.status === "held"));
  assert.ok(!fs.existsSync(items[0].path) && !fs.existsSync(items[1].path));
  assert.equal(listHeld().length, 2);

  const r = restoreHeld(listHeld());
  assert.equal(r.restored.length, 2);
  assert.equal(fs.readFileSync(items[0].path, "utf8").length, 1000);
  assert.ok(fs.existsSync(path.join(items[1].path, "data")));
  assert.equal(listHeld().length, 0);
  assert.equal(fs.existsSync(HOLD_DIR) ? fs.readdirSync(HOLD_DIR).length : 0, 0, "empty batches are tidied away");
});

test("restore never overwrites something that came back in the meantime", () => {
  const items = makeItems();
  holdItems(items);
  fs.writeFileSync(items[0].path, "new file with the same name");
  const r = restoreHeld(listHeld());
  assert.equal(r.conflicts.length, 1);
  assert.equal(fs.readFileSync(items[0].path, "utf8"), "new file with the same name");
  purgeHeld(listHeld());
});

test("purge deletes held items for good", () => {
  const items = makeItems();
  fs.rmSync(items[0].path);
  holdItems([items[1]]);
  const r = purgeHeld(listHeld());
  assert.equal(r.purged.length, 1);
  assert.equal(listHeld().length, 0);
  assert.ok(!fs.existsSync(items[1].path));
});
