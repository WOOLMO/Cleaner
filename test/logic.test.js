import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { decide } from "../src/decide.js";
import { redact, isSensitiveName, inspectFile } from "../src/inspect.js";
import { isSafeToRemove } from "../src/remove.js";
import { pickUnits } from "../src/map.js";
import { makeHeader, writeDb, readDb } from "../src/db.js";

test("gemini alone can never mark something safe to remove", () => {
  const unknown = { verdict: "unknown", category: "large-file", reason: "Large file" };
  assert.equal(decide(unknown, { verdict: "remove", confidence: 0.99, category: "x", reason: "y" }).verdict, "review");
  const review = { verdict: "review", category: "installer", reason: "old" };
  assert.equal(decide(review, { verdict: "remove", confidence: 1, category: "x", reason: "y" }).verdict, "review");
});

test("a rule and gemini agreeing makes it safe; gemini can always say keep", () => {
  const rule = { verdict: "remove", category: "app-cache", reason: "cache" };
  assert.equal(decide(rule, { verdict: "remove", confidence: 0.9, category: "cache", reason: "c" }).verdict, "remove");
  assert.equal(decide(rule, { verdict: "keep", confidence: 0.9, category: "x", reason: "y" }).verdict, "keep");
});

test("sensitive items are capped at your call", () => {
  const rule = { verdict: "remove", category: "temp-file", reason: "tmp", sensitive: true };
  assert.equal(decide(rule, null).verdict, "review");
  assert.equal(decide(rule, { verdict: "remove", confidence: 1, category: "x", reason: "y" }).verdict, "review");
});

test("without gemini, rules decide and unknown files are kept", () => {
  assert.equal(decide({ verdict: "remove", category: "c", reason: "r" }, null).verdict, "remove");
  assert.equal(decide({ verdict: "unknown", category: "c", reason: "r" }, null).verdict, "keep");
});

test("previews have secrets, long tokens and emails masked", () => {
  const out = redact("api_key=abc123 password: hunter2 mail me@example.com token AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
  assert.doesNotMatch(out, /abc123|hunter2|me@example\.com|AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/);
});

test("credential-like names and contents are sensitive", () => {
  for (const name of [".env", "server_creds.txt", "id_rsa", "wallet.dat", "my.key"]) assert.ok(isSensitiveName(name), name);
  assert.ok(!isSensitiveName("holiday.jpg"));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cleaner-inspect-"));
  const p = path.join(dir, "notes.txt");
  fs.writeFileSync(p, "server login\npassword = hunter2\n");
  const info = inspectFile(p, fs.statSync(p).size, { allowPreview: true });
  assert.equal(info.sensitive, true);
  assert.equal(info.preview, null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("file types are read from the content, not the name", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cleaner-inspect-"));
  const cases = [["a.bin", "MZ\x90\x00", "Windows program or library"], ["b.bin", "%PDF-1.7", "PDF document"], ["c.bin", "\x89PNG\r\n", "PNG image"]];
  for (const [name, head, expected] of cases) {
    const p = path.join(dir, name);
    fs.writeFileSync(p, Buffer.from(head + "\0".repeat(20), "latin1"));
    assert.equal(inspectFile(p, fs.statSync(p).size, { allowPreview: false }).fileType, expected);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test("system folders, drive roots and the home folder can never be removed", () => {
  assert.equal(isSafeToRemove("C:\\"), false);
  assert.equal(isSafeToRemove("C:\\Users"), false);
  assert.equal(isSafeToRemove("C:\\Windows\\Temp\\x.tmp"), false);
  assert.equal(isSafeToRemove("C:\\Program Files\\App\\cache"), false);
  assert.equal(isSafeToRemove(os.homedir()), false);
  assert.equal(isSafeToRemove(path.join(os.homedir(), "Downloads", "x.crdownload")), true);
});

test("the space map looks inside containers and steps through wrappers", () => {
  const GB = 1024 ** 3;
  const sizes = new Map([
    ["C:\\", 100 * GB],
    ["C:\\Program Files", 40 * GB],
    ["C:\\Program Files\\Epic Games", 34 * GB],
    ["C:\\Program Files\\Epic Games\\UE_5.5", 33.5 * GB],
    ["C:\\Program Files\\Small", 6 * GB],
    ["C:\\Users", 50 * GB],
    ["C:\\Users\\me", 50 * GB],
    ["C:\\Users\\me\\Downloads", 12 * GB],
    ["C:\\Users\\me\\Downloads\\Games", 4 * GB],
    ["C:\\Users\\me\\Videos", 38 * GB],
    ["C:\\Windows", 10 * GB],
  ]);
  const kids = new Map([
    ["C:\\", ["C:\\Program Files", "C:\\Users", "C:\\Windows"]],
    ["C:\\Program Files", ["C:\\Program Files\\Epic Games", "C:\\Program Files\\Small"]],
    ["C:\\Program Files\\Epic Games", ["C:\\Program Files\\Epic Games\\UE_5.5"]],
    ["C:\\Users", ["C:\\Users\\me"]],
    ["C:\\Users\\me", ["C:\\Users\\me\\Downloads", "C:\\Users\\me\\Videos"]],
    ["C:\\Users\\me\\Downloads", ["C:\\Users\\me\\Downloads\\Games"]],
  ]);
  const units = pickUnits({ root: "C:\\", sizes, kids }, { minBytes: GB });
  const paths = units.map((u) => u.path);
  assert.ok(paths.includes("C:\\Program Files\\Epic Games\\UE_5.5"), "steps into the 99% child");
  assert.ok(paths.includes("C:\\Users\\me\\Videos"));
  assert.ok(paths.includes("C:\\Windows"));
  assert.ok(!paths.includes("C:\\Users"), "containers are not reported as one block");
  const loose = units.find((u) => u.path === "C:\\Users\\me\\Downloads");
  assert.equal(loose?.loose, true);
  assert.equal(loose?.size, 8 * GB);
  assert.equal(units[0].path, "C:\\Users\\me\\Videos", "biggest first");
});

test("the database round-trips paths with spaces, quotes and emoji", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cleaner-db-"));
  const file = path.join(dir, "db.txt");
  const entries = [
    { id: 1, status: "pending", verdict: "remove", confidence: 0.9, size: 1234, category: "temp", path: "C:\\a b\\Rapport d'été 🎵.tmp", reason: "tab\there and\nnewline" },
    { id: 2, status: "held", verdict: "review", confidence: 0.5, size: 99, category: "installer", path: "C:\\x\\setup.exe", reason: "old" },
  ];
  writeDb(file, makeHeader({ roots: ["C:\\a b"], model: "test" }), entries);
  const back = readDb(file);
  assert.equal(back.entries.length, 2);
  assert.equal(back.entries[0].path, entries[0].path);
  assert.equal(back.entries[0].reason, "tab here and newline");
  assert.equal(back.entries[1].status, "held");
  assert.ok(back.header.some((h) => h.includes("classified by: test")));
  fs.rmSync(dir, { recursive: true, force: true });
});
