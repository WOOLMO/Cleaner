import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { DATA_DIR } from "./config.js";
import { extractZip } from "./zip.js";

// YARA, the pattern engine malware researchers use, with the community rules curated by YARA Forge.
// Both are downloaded from their official GitHub releases only when the user asks, and every download
// must match the SHA-256 that GitHub publishes for it, or it is thrown away.

export const YARA_DIR = path.join(DATA_DIR, "yara");
const STATE = path.join(YARA_DIR, "state.json");
const ENGINE_REPO = "VirusTotal/yara";
const RULES_REPO = "YARAHQ/yara-forge";
const RULES_ASSET = "yara-forge-rules-core.zip";
const UA = { "user-agent": "Cleaner (github.com/WOOLMO/Cleaner)", accept: "application/vnd.github+json" };

const exe = (name) => path.join(YARA_DIR, name);

export function yaraStatus() {
  let state = {};
  try {
    state = JSON.parse(fs.readFileSync(STATE, "utf8"));
  } catch {
    // not installed
  }
  const ready = fs.existsSync(exe("yara64.exe")) && fs.existsSync(path.join(YARA_DIR, "rules.yarc"));
  return { ready, engine: state.engine ?? null, rules: state.rules ?? null };
}

async function getJson(url, fetchImpl, signal) {
  const res = await fetchImpl(url, { headers: UA, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  return res.json();
}

// Downloads one release asset and checks it against GitHub's published digest.
async function download(asset, fetchImpl, signal) {
  const digest = /^sha256:([a-f0-9]{64})$/i.exec(asset.digest ?? "")?.[1];
  if (!digest) throw new Error(`${asset.name} has no published checksum, so it is not trusted`);
  const res = await fetchImpl(asset.browser_download_url, { headers: { "user-agent": UA["user-agent"] }, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const got = crypto.createHash("sha256").update(buf).digest("hex");
  if (got !== digest.toLowerCase()) throw new Error(`${asset.name} does not match its published checksum; nothing was installed`);
  return buf;
}

function run(file, args, { timeoutMs = 120_000, signal } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { windowsHide: true });
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill(), timeoutMs);
    const onAbort = () => child.kill();
    signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.setEncoding("utf8").on("data", (d) => (out += d));
    child.stderr.setEncoding("utf8").on("data", (d) => (err += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (signal?.aborted) reject(signal.reason);
      else resolve({ code, out, err });
    });
  });
}

export async function installYara({ fetchImpl = globalThis.fetch, signal, onProgress } = {}) {
  fs.mkdirSync(YARA_DIR, { recursive: true });
  const tmp = path.join(YARA_DIR, "download.zip");
  // the newest engine release that ships a Windows build with a published checksum
  onProgress?.("engine");
  const releases = await getJson(`https://api.github.com/repos/${ENGINE_REPO}/releases?per_page=20`, fetchImpl, signal);
  let engine = null;
  for (const r of releases) {
    const asset = r.assets?.find((a) => /win64\.zip$/i.test(a.name) && a.digest);
    if (asset && !r.prerelease) {
      engine = { release: r.tag_name, asset };
      break;
    }
  }
  if (!engine) throw new Error("no YARA release with a verified Windows build was found");
  fs.writeFileSync(tmp, await download(engine.asset, fetchImpl, signal));
  extractZip(tmp, YARA_DIR, { filter: (e) => /(^|\/)yarac?64\.exe$/i.test(e.name) });
  if (!fs.existsSync(exe("yara64.exe")) || !fs.existsSync(exe("yarac64.exe"))) throw new Error("the YARA download did not contain yara64.exe");

  onProgress?.("rules");
  const rules = await updateYaraRules({ fetchImpl, signal, onProgress });
  fs.rmSync(tmp, { force: true });
  const state = { engine: { version: engine.release, installed: new Date().toISOString() }, rules };
  fs.writeFileSync(STATE, JSON.stringify(state, null, 2), "utf8");
  return state;
}

export async function updateYaraRules({ fetchImpl = globalThis.fetch, signal, onProgress } = {}) {
  const tmp = path.join(YARA_DIR, "rules.zip");
  const release = await getJson(`https://api.github.com/repos/${RULES_REPO}/releases/latest`, fetchImpl, signal);
  const asset = release.assets?.find((a) => a.name === RULES_ASSET);
  if (!asset) throw new Error("the YARA Forge release has no core rule pack");
  fs.writeFileSync(tmp, await download(asset, fetchImpl, signal));
  const [source] = extractZip(tmp, YARA_DIR, { filter: (e) => /\.yar$/i.test(e.name) });
  fs.rmSync(tmp, { force: true });
  if (!source) throw new Error("the rule pack had no rules in it");
  const rulesFile = path.join(YARA_DIR, "rules.yar");
  fs.renameSync(source, rulesFile);
  onProgress?.("compile");
  const compiled = path.join(YARA_DIR, "rules.yarc");
  const r = await run(exe("yarac64.exe"), ["-w", rulesFile, compiled], { timeoutMs: 300_000, signal });
  if (r.code !== 0 || !fs.existsSync(compiled)) throw new Error(`the rules did not compile: ${(r.err || r.out).split("\n")[0]}`);
  const count = (fs.readFileSync(rulesFile, "utf8").match(/^\s*(private\s+|global\s+)*rule\s+\w+/gm) ?? []).length;
  const info = { release: release.tag_name, installed: new Date().toISOString(), count };
  try {
    const state = JSON.parse(fs.readFileSync(STATE, "utf8"));
    fs.writeFileSync(STATE, JSON.stringify({ ...state, rules: info }, null, 2), "utf8");
  } catch {
    // first install writes the state itself
  }
  return info;
}

// "Rule [meta] path" lines, as printed by yara -m.
export function parseYaraOutput(text) {
  const hits = [];
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^(\w+)\s+\[(.*)\]\s+([a-z]:\\.+)$/i.exec(line.trim()) ?? /^(\w+)\s+()([a-z]:\\.+)$/i.exec(line.trim());
    if (!m) continue;
    const meta = {};
    for (const kv of m[2].matchAll(/(\w+)=(?:"((?:[^"\\]|\\.)*)"|([^,\]]+))/g)) meta[kv[1]] = kv[2] ?? kv[3];
    hits.push({ rule: m[1], file: m[3], score: Number(meta.score) || null, description: meta.description ?? null, author: meta.author ?? null });
  }
  return hits;
}

export async function scanYara(files, { signal, timeoutMs = 10 * 60_000 } = {}) {
  if (!files.length || !yaraStatus().ready) return [];
  const list = path.join(YARA_DIR, `scan-${process.pid}.txt`);
  fs.writeFileSync(list, files.join("\r\n"), "utf8");
  try {
    // flags, then the compiled rules, then the file that lists what to scan
    const r = await run(exe("yara64.exe"), ["-w", "-N", "-m", "-p", "4", "-a", "30", "-C", "--scan-list", path.join(YARA_DIR, "rules.yarc"), list], { timeoutMs, signal });
    return parseYaraOutput(r.out);
  } finally {
    fs.rmSync(list, { force: true });
  }
}
