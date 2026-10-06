import { test } from "node:test";
import assert from "node:assert/strict";
import { Gemini, classifyItems, explainFolders } from "../src/gemini.js";

// A fake fetch that plays back scripted responses, so no test ever calls Google.
function scripted(responses) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: init?.body ? JSON.parse(init.body) : null });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return { ok: next.status === 200, status: next.status, statusText: "", json: async () => next.body };
  };
  return { fetchImpl, calls };
}
const answer = (obj, modelVersion = "fake-model") => ({
  status: 200,
  body: { modelVersion, candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] },
});
const gemini = (fetchImpl, slept = []) => new Gemini({
  apiKey: "test",
  models: ["first-model", "second-model"],
  minIntervalMs: 0,
  retryBaseMs: 1,
  fetchImpl,
  sleep: async (ms) => slept.push(ms),
});

const items = [
  { aiId: 1, path: "C:\\x\\a.crdownload", kind: "file", size: 10, mtime: Date.now(), category: "partial-download", verdict: "remove", reason: "r" },
  { aiId: 2, path: "C:\\x\\b.jpg", kind: "file", size: 10, mtime: Date.now(), category: "large-file", verdict: "unknown", reason: "r" },
];

test("a busy model falls back to the next one", async () => {
  const { fetchImpl, calls } = scripted([
    { status: 503, body: { error: { message: "high demand" } } },
    answer({ results: [{ id: 1, verdict: "remove", confidence: 0.9, category: "temp-file", reason: "old" }] }, "second-v"),
  ]);
  const g = gemini(fetchImpl);
  const { results, error } = await classifyItems(items, { gemini: g, batchSize: 40 });
  assert.equal(error, null);
  assert.equal(results.get(1).verdict, "remove");
  assert.match(calls[0].url, /first-model/);
  assert.match(calls[1].url, /second-model/);
  assert.deepEqual([...g.used], ["second-v"]);
});

test("a short rate limit waits and retries the same model", async () => {
  const slept = [];
  const { fetchImpl, calls } = scripted([
    { status: 429, body: { error: { message: "slow down", details: [{ retryDelay: "2s" }] } } },
    answer({ results: [] }),
  ]);
  await classifyItems(items, { gemini: gemini(fetchImpl, slept), batchSize: 40 });
  assert.ok(slept.includes(2500), "waits the delay Google asked for");
  assert.match(calls[1].url, /first-model/);
});

test("a rejected key stops with a clear message and keeps earlier results", async () => {
  const { fetchImpl } = scripted([
    answer({ results: [{ id: 1, verdict: "review", confidence: 0.5, category: "c", reason: "r" }] }),
    { status: 400, body: { error: { message: "API key not valid. Please pass a valid API key." } } },
  ]);
  const { results, error } = await classifyItems(items, { gemini: gemini(fetchImpl), batchSize: 1 });
  assert.equal(results.size, 1);
  assert.match(error.message, /API key was rejected/);
});

test("network errors are retried", async () => {
  const { fetchImpl } = scripted([new TypeError("fetch failed"), answer({ results: [] })]);
  const { error } = await classifyItems(items, { gemini: gemini(fetchImpl), batchSize: 40 });
  assert.equal(error, null);
});

test("previews and sensitive flags are what gets sent, nothing else from the file", async () => {
  const { fetchImpl, calls } = scripted([answer({ results: [] })]);
  const withPreview = [{ ...items[1], preview: "Chapter 2", sensitive: true, fileType: "text" }];
  await classifyItems(withPreview, { gemini: gemini(fetchImpl), batchSize: 40 });
  const sent = JSON.parse(calls[0].body.contents[0].parts[0].text.replace(/^[^\n]*\n/, ""))[0];
  assert.deepEqual(Object.keys(sent).sort(), ["fileType", "id", "kind", "localGuess", "modified", "path", "preview", "sensitive", "size"]);
});

test("the space map sends folder names and sizes only", async () => {
  const { fetchImpl, calls } = scripted([answer({ results: [{ id: 1, label: "Unreal Engine", kind: "app", advice: "reclaim", tip: "Uninstall it" }] })]);
  const units = [{ path: "C:\\Program Files\\Epic Games\\UE_5.5", size: 3e10, children: [{ name: "Engine", size: 3e10 }] }];
  const { results } = await explainFolders(units, { gemini: gemini(fetchImpl) });
  assert.equal(results.get(1).advice, "reclaim");
  const sent = JSON.parse(calls[0].body.contents[0].parts[0].text.replace(/^[^\n]*\n/, ""))[0];
  assert.deepEqual(Object.keys(sent).sort(), ["biggestSubfolders", "id", "path", "size"]);
});
