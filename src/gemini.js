import { formatSize, daysAgo } from "./ui.js";

const API = "https://generativelanguage.googleapis.com/v1beta/models/";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const SYSTEM = `You review files and folders on a Windows PC and decide which ones the owner does not need.
Return exactly one result for every item, using the same id.

verdict:
- remove: clearly unnecessary and safe to delete. Examples: caches, temporary files, unfinished downloads, crash dumps, exact duplicates (duplicateOf is set), dependency or build folders that can be rebuilt (node_modules, __pycache__, .next), leftovers of software that is no longer installed.
- review: probably unnecessary, but the owner should decide. Examples: installers, archives that were already extracted, old app versions, old logs, Python virtual environments, large files whose value is unclear.
- keep: personal or hard-to-replace data, or anything in active use. Examples: documents, photos and videos the owner made, source code, game saves, settings, databases, credentials, keys, anything marked sensitive.

Rules:
- When unsure, choose review or keep, never remove.
- Never choose remove for personal media, documents, source code, game saves or anything sensitive.
- localGuess comes from simple filename rules and can be wrong. Judge from the path, size, age, fileType and preview.
- Only call an item a duplicate when duplicateOf is set; that was verified byte for byte. Similar names are not proof, and a copy in a Backup folder may be intentional.

confidence: 0 to 1, how sure you are.
category: short kebab-case label such as cache, temp-file, duplicate, installer, build-output, personal-media.
reason: a short plain label under 70 characters that a non-technical person understands, written like "Unfinished download, untouched for 40 days" or "Exact copy of a video kept elsewhere". Do not start with "This is" and do not repeat the path.`;

const SCHEMA = {
  type: "OBJECT",
  properties: {
    results: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          id: { type: "INTEGER" },
          verdict: { type: "STRING", enum: ["remove", "review", "keep"] },
          confidence: { type: "NUMBER" },
          category: { type: "STRING" },
          reason: { type: "STRING" },
        },
        required: ["id", "verdict", "confidence", "category", "reason"],
      },
    },
  },
  required: ["results"],
};

function retryDelayMs(data) {
  const info = (data.error?.details ?? []).find((d) => d.retryDelay);
  const match = info?.retryDelay?.match(/^([\d.]+)s$/);
  return match ? Math.ceil(parseFloat(match[1]) * 1000) : null;
}

function networkError(err) {
  const code = err.cause?.code ?? "";
  if (/CERT|SELF_SIGNED|LEAF_SIGNATURE/i.test(code)) return `TLS certificate problem (${code}). An antivirus may be scanning HTTPS.`;
  if (err.name === "TimeoutError") return "Gemini took too long to answer";
  return `${err.message}${code ? ` (${code})` : ""}`;
}

export class Gemini {
  constructor({ apiKey, models, minIntervalMs = 4000 }) {
    this.apiKey = apiKey;
    this.models = models;
    this.index = 0;
    this.minIntervalMs = minIntervalMs;
    this.lastCall = 0;
    this.used = new Set();
  }

  get model() {
    return this.models[this.index % this.models.length];
  }

  // Free-tier limits are per minute, so calls are spaced out.
  async pace() {
    const wait = this.lastCall + this.minIntervalMs - Date.now();
    if (wait > 0) await sleep(wait);
    this.lastCall = Date.now();
  }

  async generate(body) {
    let lastError = "no answer";
    const attempts = 3 * this.models.length + 2;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      await this.pace();
      const model = this.model;
      let res, data;
      try {
        res = await fetch(`${API}${model}:generateContent`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(120_000),
        });
        data = await res.json().catch(() => ({}));
      } catch (err) {
        lastError = networkError(err);
        await sleep(Math.min(30_000, 2000 * attempt));
        continue;
      }

      if (res.ok) {
        const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
        try {
          const parsed = JSON.parse(text);
          this.used.add(data.modelVersion || model);
          return parsed;
        } catch {
          lastError = `${model} answered with something that is not JSON`;
          continue;
        }
      }

      const message = data.error?.message || res.statusText;
      lastError = `${model}: HTTP ${res.status} ${message}`;
      if ([400, 401, 403].includes(res.status)) {
        if (/api key/i.test(message)) throw new Error("the API key was rejected, check GEMINI_API_KEY in .env");
        throw new Error(`gemini refused the request (${res.status}): ${message}`);
      }
      if (res.status === 429) {
        const delay = retryDelayMs(data);
        if (delay !== null && delay <= 60_000) {
          await sleep(delay + 500);
        } else {
          this.index++; // this model's quota is used up, try the next one
          await sleep(2000);
        }
        continue;
      }
      this.index++; // 404 or a busy model: move along the fallback list
      await sleep(Math.min(20_000, 1500 * attempt));
    }
    throw new Error(lastError);
  }
}

function toPrompt(item) {
  const entry = {
    id: item.aiId,
    path: item.path,
    kind: item.kind,
    size: formatSize(item.size),
    modified: `${daysAgo(item.mtime)} days ago`,
  };
  if (item.kind === "dir") entry.files = item.files;
  entry.localGuess = { category: item.category, verdict: item.verdict, note: item.reason };
  if (item.fileType) entry.fileType = item.fileType;
  if (item.duplicateOf) entry.duplicateOf = item.duplicateOf;
  if (item.sensitive) entry.sensitive = true;
  if (item.preview) entry.preview = item.preview;
  return entry;
}

// Sends items in batches. On a hard failure it returns what it has so far plus the error.
export async function classifyItems(items, { gemini, batchSize, onProgress }) {
  const results = new Map();
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const body = {
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: "user", parts: [{ text: "Classify these items:\n" + JSON.stringify(batch.map(toPrompt)) }] }],
      generationConfig: { temperature: 0.1, responseMimeType: "application/json", responseSchema: SCHEMA },
    };
    try {
      const out = await gemini.generate(body);
      for (const r of out.results ?? []) if (Number.isInteger(r.id)) results.set(r.id, r);
    } catch (error) {
      return { results, error };
    }
    onProgress?.(Math.min(i + batchSize, items.length), items.length);
  }
  return { results, error: null };
}
