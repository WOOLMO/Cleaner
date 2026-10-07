import { formatSize, daysAgo } from "./ui.js";

const API = "https://generativelanguage.googleapis.com/v1beta/models";
const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const CLASSIFY_PROMPT = `You review files and folders on a Windows PC and decide which ones the owner does not need.
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

const CLASSIFY_SCHEMA = {
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

export const EXPLAIN_PROMPT = `You explain what the biggest folders on a Windows PC are, so the owner can decide how to free space.
For every folder return one result with the same id:
- label: what it is in plain words, under 45 characters, like "Unreal Engine 5.5 (game engine)" or "Windows system files".
- kind: system, app, game, dev-tool, cache, user-files, downloads or other.
- advice: keep (needed or personal), check (the owner should look), or reclaim (space can safely be won back).
- tip: one plain sentence under 100 characters with the safe way to win the space back, or why to keep it.

Rules:
- Never suggest deleting Windows system folders by hand. Point to Disk Cleanup or Storage Sense instead.
- For installed programs and games, suggest uninstalling through Settings > Apps or their launcher, never deleting the folder.
- For personal files, suggest moving them to another drive or the cloud rather than deleting them.
- "loose" means files sitting directly inside that folder rather than in its subfolders.`;

const EXPLAIN_SCHEMA = {
  type: "OBJECT",
  properties: {
    results: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          id: { type: "INTEGER" },
          label: { type: "STRING" },
          kind: { type: "STRING", enum: ["system", "app", "game", "dev-tool", "cache", "user-files", "downloads", "other"] },
          advice: { type: "STRING", enum: ["keep", "check", "reclaim"] },
          tip: { type: "STRING" },
        },
        required: ["id", "label", "kind", "advice", "tip"],
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
  constructor({ apiKey, models, minIntervalMs = 4000, retryBaseMs = 1500, fetchImpl = globalThis.fetch, sleep = realSleep, signal }) {
    this.apiKey = apiKey;
    this.models = models;
    this.signal = signal;
    this.index = 0;
    this.minIntervalMs = minIntervalMs;
    this.retryBaseMs = retryBaseMs;
    this.fetch = fetchImpl;
    this.sleep = sleep;
    this.lastCall = 0;
    this.used = new Set();
  }

  get model() {
    return this.models[this.index % this.models.length];
  }

  // Free-tier limits are per minute, so calls are spaced out.
  async pace() {
    const wait = this.lastCall + this.minIntervalMs - Date.now();
    if (wait > 0) await this.sleep(wait);
    this.lastCall = Date.now();
  }

  async generate(body) {
    let lastError = "no answer";
    const attempts = 3 * this.models.length + 2;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      this.signal?.throwIfAborted();
      await this.pace();
      const model = this.model;
      let res, data;
      try {
        const timeout = AbortSignal.timeout(120_000);
        res = await this.fetch(`${API}/${model}:generateContent`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
          body: JSON.stringify(body),
          signal: this.signal ? AbortSignal.any([timeout, this.signal]) : timeout,
        });
        data = await res.json().catch(() => ({}));
      } catch (err) {
        if (this.signal?.aborted) throw this.signal.reason;
        lastError = networkError(err);
        await this.sleep(Math.min(30_000, this.retryBaseMs * attempt));
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
        if (/api key/i.test(message)) throw new Error("the API key was rejected, run cleaner setup to change it");
        throw new Error(`gemini refused the request (${res.status}): ${message}`);
      }
      if (res.status === 429) {
        const delay = retryDelayMs(data);
        if (delay !== null && delay <= 60_000) {
          await this.sleep(delay + 500);
        } else {
          this.index++; // this model's quota is used up, try the next one
          await this.sleep(this.retryBaseMs);
        }
        continue;
      }
      this.index++; // 404 or a busy model: move along the fallback list
      await this.sleep(Math.min(20_000, this.retryBaseMs * attempt));
    }
    throw new Error(lastError);
  }

  // A cheap request that tells whether a key works.
  static async checkKey(apiKey, fetchImpl = globalThis.fetch) {
    try {
      const res = await fetchImpl(`${API}?pageSize=1`, { headers: { "x-goog-api-key": apiKey }, signal: AbortSignal.timeout(20_000) });
      if (res.ok) return { ok: true };
      const data = await res.json().catch(() => ({}));
      return { ok: false, message: data.error?.message || `HTTP ${res.status}` };
    } catch (err) {
      return { ok: false, message: networkError(err) };
    }
  }
}

function request(prompt, schema, text) {
  return {
    systemInstruction: { parts: [{ text: prompt }] },
    contents: [{ role: "user", parts: [{ text }] }],
    generationConfig: { temperature: 0.1, responseMimeType: "application/json", responseSchema: schema },
  };
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
export async function classifyItems(items, { gemini, batchSize, onProgress, signal }) {
  const results = new Map();
  for (let i = 0; i < items.length; i += batchSize) {
    signal?.throwIfAborted();
    const batch = items.slice(i, i + batchSize);
    try {
      const out = await gemini.generate(request(CLASSIFY_PROMPT, CLASSIFY_SCHEMA, "Classify these items:\n" + JSON.stringify(batch.map(toPrompt))));
      for (const r of out.results ?? []) if (Number.isInteger(r.id)) results.set(r.id, r);
    } catch (error) {
      if (signal?.aborted) throw error;
      return { results, error };
    }
    onProgress?.(Math.min(i + batchSize, items.length), items.length);
  }
  return { results, error: null };
}

// One request: what each big folder is and how to win its space back. Only folder names and sizes are sent.
export async function explainFolders(units, { gemini }) {
  const entries = units.map((u, i) => ({
    id: i + 1,
    path: u.path,
    size: formatSize(u.size),
    ...(u.loose ? { loose: true } : {}),
    biggestSubfolders: u.children.map((ch) => `${ch.name} (${formatSize(ch.size)})`),
  }));
  try {
    const out = await gemini.generate(request(EXPLAIN_PROMPT, EXPLAIN_SCHEMA, "Explain these folders:\n" + JSON.stringify(entries)));
    const results = new Map();
    for (const r of out.results ?? []) if (Number.isInteger(r.id)) results.set(r.id, r);
    return { results, error: null };
  } catch (error) {
    return { results: new Map(), error };
  }
}
