import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./config.js";

// Open threat intelligence, downloaded and cached on this PC. Updating sends nothing about the PC; the
// feeds are plain public lists. Scans then check against the local copies, offline.
//   MalwareBazaar  recent malware samples (SHA-256), abuse.ch
//   URLhaus        hosts serving malware right now, abuse.ch
//   Feodo Tracker  botnet command-and-control servers (IPs), abuse.ch
//   LOLDrivers     Windows drivers known to be malicious or abused to switch security off

export const INTEL_DIR = path.join(DATA_DIR, "intel");
const DAY = 86_400_000;

export const FEEDS = {
  malwareBazaar: {
    label: "MalwareBazaar recent samples",
    url: "https://bazaar.abuse.ch/export/txt/sha256/recent/",
    maxAge: 6 * 3600_000,
    parse: (text) => [...new Set(text.split(/\r?\n/).map((l) => l.trim().toLowerCase()).filter((l) => /^[a-f0-9]{64}$/.test(l)))],
  },
  urlhaus: {
    label: "URLhaus malware hosts",
    url: "https://urlhaus.abuse.ch/downloads/hostfile/",
    maxAge: 6 * 3600_000,
    parse: (text) => [...new Set(text.split(/\r?\n/).filter((l) => l && !l.startsWith("#")).map((l) => l.trim().split(/\s+/).pop().toLowerCase()).filter((h) => /^[a-z0-9.-]+$/.test(h) && h !== "localhost"))],
  },
  feodo: {
    label: "Feodo Tracker botnet servers",
    url: "https://feodotracker.abuse.ch/downloads/ipblocklist.json",
    maxAge: 6 * 3600_000,
    parse: (text) => {
      const list = JSON.parse(text);
      return (Array.isArray(list) ? list : []).map((e) => ({ ip: e.ip_address, port: e.port, malware: e.malware ?? null, status: e.status ?? null })).filter((e) => typeof e.ip === "string");
    },
  },
  lolDrivers: {
    label: "LOLDrivers",
    url: "https://raw.githubusercontent.com/magicsword-io/LOLDrivers/main/loldrivers.io/content/api/drivers.json",
    maxAge: 7 * DAY,
    parse: (text) => {
      const out = [];
      for (const d of JSON.parse(text)) {
        const malicious = /malicious/i.test(d.Category ?? "");
        const name = (Array.isArray(d.Tags) && d.Tags[0]) || d.Id || "driver";
        for (const s of d.KnownVulnerableSamples ?? []) {
          if (typeof s.SHA256 === "string" && /^[a-f0-9]{64}$/i.test(s.SHA256)) out.push({ sha256: s.SHA256.toLowerCase(), name: s.Filename || name, malicious });
        }
      }
      return out;
    },
  },
};

const fileOf = (name) => path.join(INTEL_DIR, `${name}.json`);

export function intelStatus() {
  const status = {};
  for (const [name, feed] of Object.entries(FEEDS)) {
    try {
      const { updated, items } = JSON.parse(fs.readFileSync(fileOf(name), "utf8"));
      status[name] = { label: feed.label, updated, count: items.length, stale: Date.now() - Date.parse(updated) > feed.maxAge };
    } catch {
      status[name] = { label: feed.label, updated: null, count: 0, stale: true };
    }
  }
  return status;
}

export async function updateIntel({ fetchImpl = globalThis.fetch, signal, only = null, force = false, onProgress } = {}) {
  fs.mkdirSync(INTEL_DIR, { recursive: true });
  const status = intelStatus();
  const report = {};
  const names = Object.keys(FEEDS).filter((n) => (!only || only.includes(n)) && (force || status[n].stale));
  for (const [i, name] of names.entries()) {
    signal?.throwIfAborted();
    const feed = FEEDS[name];
    onProgress?.({ feed: name, label: feed.label, done: i, total: names.length });
    try {
      const timeout = AbortSignal.timeout(name === "lolDrivers" ? 120_000 : 30_000);
      const res = await fetchImpl(feed.url, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout, headers: { "user-agent": "Cleaner (github.com/WOOLMO/Cleaner)" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const items = feed.parse(await res.text());
      if (!items.length) throw new Error("empty list");
      fs.writeFileSync(fileOf(name), JSON.stringify({ updated: new Date().toISOString(), source: feed.url, items }), "utf8");
      report[name] = { ok: true, count: items.length };
    } catch (err) {
      if (signal?.aborted) throw err;
      report[name] = { ok: false, error: err.message };
    }
  }
  return report;
}

// The local copies, ready for fast lookups.
export function loadIntel() {
  const read = (name) => {
    try {
      return JSON.parse(fs.readFileSync(fileOf(name), "utf8")).items;
    } catch {
      return [];
    }
  };
  const drivers = new Map(read("lolDrivers").map((d) => [d.sha256, d]));
  return {
    hashes: new Set(read("malwareBazaar")),
    hosts: new Set(read("urlhaus")),
    ips: new Map(read("feodo").map((e) => [e.ip, e])),
    drivers,
  };
}

// Hosts in text: URLs and bare domains in scripts, shortcuts and download sources.
export function hostsIn(text) {
  const out = new Set();
  for (const m of String(text).matchAll(/\bhttps?:\/\/([a-z0-9.-]+)(?::\d+)?/gi)) out.add(m[1].toLowerCase());
  return [...out];
}

// CIRCL hashlookup: a public database of known files (NSRL and others), which also marks samples known
// to be malicious. Only the SHA-256 is sent.
export async function hashLookup(sha256, { fetchImpl = globalThis.fetch, signal } = {}) {
  const timeout = AbortSignal.timeout(15_000);
  const res = await fetchImpl(`https://hashlookup.circl.lu/lookup/sha256/${sha256}`, {
    headers: { accept: "application/json" },
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (res.status === 404) return { known: false };
  if (!res.ok) throw new Error(`hashlookup answered ${res.status}`);
  const d = await res.json();
  if (d.KnownMalicious) return { known: true, malicious: String(d.KnownMalicious) };
  return { known: true, malicious: null, name: d.FileName ?? d.ProductName ?? null, source: d.source ?? (d["hashlookup:trust"] ? "hashlookup" : "NSRL") };
}
