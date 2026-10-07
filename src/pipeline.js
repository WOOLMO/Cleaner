import { scan } from "./scan.js";
import { inspectFile } from "./inspect.js";
import { Gemini, classifyItems } from "./gemini.js";
import { decide } from "./decide.js";
import { DEFAULTS } from "./config.js";

// One scan from start to finish, shared by the CLI and the desktop app:
// walk and hash, look inside files, Gemini review, then the final verdicts.
// Events passed to onEvent: walk, walked, hash, hashed, inspect, inspected, ai, aiDone.
// ai: { apiKey, models } to use Gemini, or null for local rules only.
export async function runScanPipeline({
  roots,
  ai = null,
  noContent = false,
  maxAi = DEFAULTS.maxAi,
  largeMB = DEFAULTS.largeFileMB,
  exclude = [],
  excludeTest = null,
  signal,
  onEvent = () => {},
  fetchImpl,
}) {
  const startedAt = Date.now();
  const { items, stats } = await scan(roots, {
    largeFileMB: largeMB,
    dupeMinMB: DEFAULTS.dupeMinMB,
    exclude,
    excludeTest,
    signal,
    onProgress: onEvent,
  });

  const files = items.filter((i) => i.kind === "file");
  files.forEach((item, n) => {
    signal?.throwIfAborted();
    onEvent({ type: "inspect", done: n + 1, total: files.length, current: item.path });
    Object.assign(item, inspectFile(item.path, item.size, { allowPreview: Boolean(ai) && !noContent && item.verdict !== "remove" }));
  });
  onEvent({
    type: "inspected",
    files: files.length,
    previews: files.filter((f) => f.preview).length,
    sensitive: files.filter((f) => f.sensitive).length,
  });

  let results = new Map();
  let model = "local rules";
  let aiError = null;
  let aiTotal = 0;
  if (ai && items.length && maxAi > 0) {
    const gemini = new Gemini({ apiKey: ai.apiKey, models: ai.models ?? DEFAULTS.models, signal, ...(fetchImpl ? { fetchImpl } : {}) });
    const forAi = [...items].sort((a, b) => b.size - a.size).slice(0, maxAi);
    forAi.forEach((item, i) => (item.aiId = i + 1));
    aiTotal = forAi.length;
    onEvent({ type: "ai", done: 0, total: aiTotal });
    const r = await classifyItems(forAi, {
      gemini,
      batchSize: DEFAULTS.batchSize,
      signal,
      onProgress: (done, total) => onEvent({ type: "ai", done, total }),
    });
    results = r.results;
    aiError = r.error;
    if (gemini.used.size) model = [...gemini.used].join(", ");
    onEvent({ type: "aiDone", checked: results.size, total: aiTotal, model, error: aiError?.message ?? null });
  }
  signal?.throwIfAborted();

  const entries = [];
  let leftOut = 0;
  for (const item of items) {
    const final = decide(item, item.aiId ? results.get(item.aiId) : null);
    if (final.verdict === "keep") {
      leftOut++;
      continue;
    }
    entries.push({
      ...final,
      size: item.size,
      path: item.path,
      status: "pending",
      kind: item.kind,
      mtime: item.mtime,
      files: item.files,
      duplicateOf: item.duplicateOf,
      fileType: item.fileType,
      sensitive: Boolean(item.sensitive),
    });
  }
  entries.sort((a, b) => (a.verdict === b.verdict ? b.size - a.size : a.verdict === "remove" ? -1 : 1));
  entries.forEach((e, i) => (e.id = i + 1));

  return {
    roots,
    entries,
    stats,
    candidates: items.length,
    checked: results.size,
    aiTotal,
    aiError: aiError?.message ?? null,
    model,
    classifiedBy: ai ? `local rules + ${model}` : "local rules",
    leftOut,
    startedAt,
    durationMs: Date.now() - startedAt,
  };
}
