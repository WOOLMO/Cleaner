// End-to-end tests of the real Electron app: the built window, preload bridge and main process.
// Demo mode runs on the built-in sample data; the real-mode test only boots and reads, it never scans or changes files.
// Run with `npm run e2e` (builds the window first).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright-core";

const desktop = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const electronPath = createRequire(import.meta.url)("electron");
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "cleaner-e2e-"));

async function launch(name, args = []) {
  const app = await electron.launch({
    executablePath: electronPath,
    args: [desktop, ...args],
    env: { ...process.env, CLEANER_HOME: path.join(sandbox, name, "data"), CLEANER_PROFILE: path.join(sandbox, name, "profile"), CLEANER_QUIET: "1" },
    timeout: 60_000,
  });
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("console", (msg) => msg.type() === "error" && errors.push(msg.text()));
  await page.waitForSelector(".shell", { timeout: 30_000 });
  return { app, page, errors };
}

const nav = (page, label) => page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: label, exact: false }).first().click();
const heading = (page) => page.locator("main.work h1").first().textContent();

let demo;
before(async () => {
  demo = await launch("demo", ["--demo"]);
});
after(async () => {
  await demo?.app.close();
  fs.rmSync(sandbox, { recursive: true, force: true });
});

test("first launch shows the welcome, and it stays dismissed", async () => {
  const { page } = demo;
  const welcome = page.getByRole("dialog", { name: "Welcome to Cleaner" });
  await welcome.waitFor();
  assert.equal(await welcome.locator(".welcome-tool").count(), 4);
  await page.getByRole("button", { name: "Get started" }).click();
  await welcome.waitFor({ state: "detached" });
});

test("every page opens from the rail", async () => {
  const { page } = demo;
  for (const [label, title] of [
    ["Scan", /findings|scan/i],
    ["Protection", /protection/i],
    ["Organize", /organize/i],
    ["Space map", /space map/i],
    ["Folder graph", /folder graph/i],
    ["Holding area", /holding/i],
    ["Activity", /activity/i],
    ["Settings", /settings/i],
    ["Overview", /.+/],
  ]) {
    await nav(page, label);
    await page.waitForFunction((l) => document.querySelector('nav[aria-label="Main"] [aria-current="page"]')?.textContent?.includes(l), label);
    assert.match((await heading(page)) ?? "", title, `${label} page heading`);
  }
});

test("scan results: findings are listed and one opens in the details panel", async () => {
  const { page } = demo;
  await nav(page, "Scan");
  const rows = page.locator("main.work .trow");
  await rows.first().waitFor();
  assert.ok((await rows.count()) > 3, "sample results are listed");
  await rows.nth(1).click();
  await page.getByRole("complementary", { name: "Item details" }).waitFor();
});

test("protection: findings are listed and one opens in the drawer", async () => {
  const { page } = demo;
  await nav(page, "Protection");
  const findings = page.locator("main.work .pr-group li");
  await findings.first().waitFor();
  assert.ok((await findings.count()) > 0);
  await findings.first().click();
  await page.getByRole("complementary", { name: "Finding details" }).waitFor();
});

test("folder graph draws a living graph", async () => {
  const { page } = demo;
  await nav(page, "Folder graph");
  await page.locator("main.work canvas").first().waitFor({ timeout: 15_000 });
  const size = await page.locator("main.work canvas").first().evaluate((c) => c.width * c.height);
  assert.ok(size > 10_000);
});

test("settings: the updates card checks for a new version", async () => {
  const { page } = demo;
  await nav(page, "Settings");
  await page.getByRole("heading", { name: "Updates" }).waitFor();
  await page.getByRole("button", { name: "Check now" }).click();
  await page.getByText("Cleaner is up to date").waitFor();
});

test("the command palette opens with Ctrl+K", async () => {
  const { page } = demo;
  await page.keyboard.press("Control+k");
  await page.getByRole("dialog", { name: "Command palette" }).waitFor();
  await page.keyboard.press("Escape");
});

test("demo mode has no page errors", () => {
  assert.deepEqual(demo.errors, []);
});

test("real mode boots on an empty profile without errors", async () => {
  const real = await launch("real");
  try {
    const { page, errors } = real;
    // the real bridge is there, not the sample data
    assert.equal(await page.evaluate(() => Boolean(window.cleaner) && window.cleanerWindow.demo === false), true);
    await page.getByRole("dialog", { name: "Welcome to Cleaner" }).waitFor();
    await page.getByRole("button", { name: "Get started" }).click();
    const info = await page.evaluate(() => window.cleaner.info());
    assert.equal(info.version, JSON.parse(fs.readFileSync(path.join(desktop, "package.json"), "utf8")).version);
    assert.ok(info.dataDir.startsWith(sandbox), "uses the test profile, not the real one");
    const settings = await page.evaluate(() => window.cleaner.getSettings());
    assert.equal(settings.settings.welcomed, true, "the welcome is remembered");
    const drives = await page.evaluate(() => window.cleaner.drives());
    assert.ok(drives.length > 0);
    // the window cannot reach Node.js
    assert.equal(await page.evaluate(() => typeof require), "undefined");
    assert.deepEqual(errors, []);
  } finally {
    await real.app.close();
  }
});
