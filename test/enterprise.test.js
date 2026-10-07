import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeFixture } from "./fixture.js";

// Policy file and data folder are read when the modules load, so point them at throwaway places first.
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "cleaner-ent-"));
process.env.CLEANER_HOME = path.join(sandbox, "data");
process.env.CLEANER_POLICY = path.join(sandbox, "policy.json");
const { loadPolicy, isExcludedByPolicy } = await import("../src/policy.js");
const { audit, readAudit } = await import("../src/audit.js");
const { runScanPipeline } = await import("../src/pipeline.js");

const root = makeFixture();
after(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
  fs.rmSync(root, { recursive: true, force: true });
});

test("no policy file means an unmanaged machine", () => {
  assert.equal(loadPolicy().managed, false);
});

test("a policy file is read, and * matches one folder level", () => {
  fs.writeFileSync(process.env.CLEANER_POLICY, JSON.stringify({
    organization: "Contoso IT", aiEnabled: false, allowPermanentDelete: false, maxAiItems: 50,
    excludePaths: ["C:\\Users\\*\\Documents\\Finance"],
  }));
  const p = loadPolicy();
  assert.equal(p.managed, true);
  assert.equal(p.organization, "Contoso IT");
  assert.equal(p.aiEnabled, false);
  assert.equal(p.allowPermanentDelete, false);
  assert.equal(p.maxAiItems, 50);
  assert.ok(isExcludedByPolicy(p, "C:\\Users\\ana\\Documents\\Finance\\q3.xlsx"));
  assert.ok(isExcludedByPolicy(p, "C:\\Users\\ana\\Documents\\Finance"));
  assert.ok(!isExcludedByPolicy(p, "C:\\Users\\ana\\Documents\\Financial"));
  assert.ok(!isExcludedByPolicy(p, "C:\\Users\\ana\\Downloads"));
});

test("an unreadable policy file fails closed", () => {
  fs.writeFileSync(process.env.CLEANER_POLICY, "{ not json");
  const p = loadPolicy();
  assert.equal(p.managed, true);
  assert.equal(p.aiEnabled, false);
  assert.equal(p.allowPreviews, false);
  assert.equal(p.allowPermanentDelete, false);
  assert.match(p.error, /unreadable/);
  fs.rmSync(process.env.CLEANER_POLICY);
});

test("the activity log records who did what, newest first", () => {
  audit("scan", { app: "desktop", roots: ["C:\\x"] });
  audit("delete", { app: "desktop", items: [{ path: "C:\\x\\a.tmp", size: 10, status: "removed" }, { path: "C:\\x\\b.tmp", size: 5, status: "failed" }] });
  const [latest, first] = readAudit();
  assert.equal(latest.action, "delete");
  assert.equal(latest.count, 2);
  assert.equal(latest.bytes, 15);
  assert.equal(latest.items[1].result, "failed");
  assert.equal(latest.user, os.userInfo().username);
  assert.equal(first.action, "scan");
});

test("the shared pipeline runs offline and reports every phase", async () => {
  const seen = new Set();
  const result = await runScanPipeline({ roots: [root], largeMB: 1, onEvent: (ev) => seen.add(ev.type) });
  for (const phase of ["walk", "walked", "hashed", "inspected"]) assert.ok(seen.has(phase), phase);
  assert.equal(result.classifiedBy, "local rules");
  assert.ok(result.entries.some((e) => e.category === "partial-download" && e.verdict === "remove"));
  assert.ok(result.entries.every((e, i) => e.id === i + 1));
  assert.ok(result.entries.findIndex((e) => e.verdict === "review") > result.entries.findLastIndex((e) => e.verdict === "remove"), "safe items come first");
});

test("the pipeline uses gemini when given a key, and gemini can only demote", async () => {
  const fetchImpl = async (url, init) => {
    const sent = JSON.parse(JSON.parse(init.body).contents[0].parts[0].text.replace(/^[^\n]*\n/, ""));
    const results = sent.map((e) => ({ id: e.id, verdict: e.localGuess.verdict === "unknown" ? "remove" : "keep", confidence: 1, category: "x", reason: "fake" }));
    return { ok: true, status: 200, json: async () => ({ modelVersion: "fake", candidates: [{ content: { parts: [{ text: JSON.stringify({ results }) }] } }] }) };
  };
  const result = await runScanPipeline({ roots: [root], largeMB: 1, ai: { apiKey: "k", models: ["m"] }, fetchImpl });
  assert.equal(result.classifiedBy, "local rules + fake");
  assert.ok(result.entries.every((e) => e.verdict !== "remove"), "gemini said keep to every rule item and could only make unknowns your-call");
});

test("a scan can be cancelled", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(runScanPipeline({ roots: [root], signal: controller.signal }), { name: "AbortError" });
});
