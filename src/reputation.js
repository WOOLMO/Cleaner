import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { DATA_DIR } from "./config.js";
import { runPowerShell, psQuote } from "./powershell.js";

// Outside opinions on a file: its digital signature, known-bad hash lists, Microsoft Defender's engine,
// and (with free keys) MalwareBazaar and VirusTotal. Online checks send the file's SHA-256 hash only.

// The EICAR test file: harmless 68 bytes every antivirus detects, used to check that a scanner works.
export const EICAR_SHA256 = "275a021bbfb6489e54d471899f7db9d1663fc695ec2fe2a2c4538aabf651fd0f";
export const BLOCKLIST_FILE = path.join(DATA_DIR, "blocklist.txt");
export const TRUSTED_FILE = path.join(DATA_DIR, "trusted.json");

// ---------- hash lists ----------
export function loadBlocklist(extraFiles = []) {
  const map = new Map([[EICAR_SHA256, "EICAR test file (harmless, used to check antivirus software)"]]);
  for (const file of [BLOCKLIST_FILE, ...extraFiles]) {
    let text;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const line of text.split(/\r?\n/)) {
      const m = /^\s*([a-f0-9]{64})\b\s*(.*)$/i.exec(line);
      if (m) map.set(m[1].toLowerCase(), m[2].trim() || `Listed in ${path.basename(file)}`);
    }
  }
  return map;
}

export function loadTrusted() {
  try {
    return JSON.parse(fs.readFileSync(TRUSTED_FILE, "utf8"));
  } catch {
    return {};
  }
}

export function trustHash(sha256, info) {
  const trusted = loadTrusted();
  trusted[sha256] = { ...info, time: new Date().toISOString() };
  fs.mkdirSync(path.dirname(TRUSTED_FILE), { recursive: true });
  fs.writeFileSync(TRUSTED_FILE, JSON.stringify(trusted, null, 2), "utf8");
  return trusted;
}

export function untrustHash(sha256) {
  const trusted = loadTrusted();
  delete trusted[sha256];
  fs.mkdirSync(path.dirname(TRUSTED_FILE), { recursive: true });
  fs.writeFileSync(TRUSTED_FILE, JSON.stringify(trusted, null, 2), "utf8");
  return trusted;
}

// ---------- digital signatures ----------
const SIGNER_STATUS = { Valid: "valid", NotSigned: "none", NotSupportedFileFormat: "none", HashMismatch: "invalid", NotTrusted: "untrusted" };

// Get-AuthenticodeSignature takes ~0.1 s a file (catalog lookups), so batches run in four PowerShells at once.
export async function checkSignatures(paths, { run = runPowerShell, signal, parallel = 4 } = {}) {
  const result = new Map();
  if (!paths.length) return result;
  const dir = path.join(DATA_DIR, "tmp");
  fs.mkdirSync(dir, { recursive: true });
  const size = Math.max(25, Math.min(250, Math.ceil(paths.length / parallel)));
  const batches = [];
  for (let i = 0; i < paths.length; i += size) batches.push(paths.slice(i, i + size));
  let next = 0;
  const worker = async () => {
    while (next < batches.length) {
      signal?.throwIfAborted();
      const n = next++;
      const list = path.join(dir, `sig-${process.pid}-${n}.txt`);
      fs.writeFileSync(list, batches[n].join("\r\n"), "utf8");
      const script = `$paths = Get-Content -LiteralPath ${psQuote(list)} -Encoding UTF8
$r = foreach ($p in $paths) { if (-not $p) { continue }
  $s = Get-AuthenticodeSignature -LiteralPath $p -ErrorAction SilentlyContinue
  if ($s) { [pscustomobject]@{ p = [string]$p; s = [string]$s.Status; n = $(if ($s.SignerCertificate) { $s.SignerCertificate.GetNameInfo('SimpleName', $false) } else { $null }); os = [bool]$s.IsOSBinary } } }
@($r) | ConvertTo-Json -Compress`;
      try {
        const raw = await run(script, { timeoutMs: 15 * 60_000, signal });
        let rows = JSON.parse(raw.trim() || "[]");
        if (!Array.isArray(rows)) rows = [rows];
        for (const r of rows) result.set(String(r.p).toLowerCase(), { status: SIGNER_STATUS[r.s] ?? "unknown", subject: r.n ?? null, os: Boolean(r.os) });
      } catch (err) {
        if (signal?.aborted) throw err;
        throw new Error(`could not read signatures: ${err.message}`);
      } finally {
        fs.rmSync(list, { force: true });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(parallel, batches.length) }, worker));
  return result;
}

// ---------- Microsoft Defender ----------
const MPCMDRUN = path.join(process.env.ProgramFiles ?? "C:\\Program Files", "Windows Defender", "MpCmdRun.exe");

export async function defenderStatus({ run = runPowerShell } = {}) {
  if (!fs.existsSync(MPCMDRUN)) return { available: false, reason: "Microsoft Defender is not installed" };
  try {
    const raw = await run("$s = Get-MpComputerStatus; [pscustomobject]@{ mode = [string]$s.AMRunningMode; updated = [string]$s.AntivirusSignatureLastUpdated; engine = [string]$s.AMEngineVersion } | ConvertTo-Json -Compress", { timeoutMs: 30_000 });
    const s = JSON.parse(raw.trim());
    const active = /^(normal|passive)/i.test(s.mode);
    const av = active ? null : await activeAntivirus(run);
    return {
      available: active,
      mode: s.mode,
      engine: s.engine,
      updated: s.updated || null,
      reason: active ? null : av ? `${av} is your active antivirus, so Defender's engine is switched off` : "Defender's engine is switched off",
    };
  } catch {
    return { available: false, reason: "Defender did not answer" };
  }
}

async function activeAntivirus(run) {
  try {
    const raw = await run("Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct | Where-Object { $_.displayName -notmatch 'Defender' } | Select-Object -First 1 -ExpandProperty displayName", { timeoutMs: 20_000 });
    return raw.trim() || null;
  } catch {
    return null;
  }
}

// MpCmdRun prints "Threat : <name>" blocks followed by the files they were found in.
export function parseDefenderOutput(text) {
  const found = [];
  let current = null;
  for (const line of String(text).split(/\r?\n/)) {
    const threat = /^\s*Threat\s*:\s*(.+?)\s*$/i.exec(line);
    if (threat) {
      current = threat[1];
      continue;
    }
    const file = /^\s*file\s*:\s*(.+?)\s*$/i.exec(line);
    if (file && current) found.push({ name: current, file: file[1].replace(/->.*$/, "").trim() });
  }
  return found;
}

function mpScan(file, signal) {
  return new Promise((resolve) => {
    const child = spawn(MPCMDRUN, ["-Scan", "-ScanType", "3", "-File", file, "-DisableRemediation"], { windowsHide: true });
    let out = "";
    const timer = setTimeout(() => child.kill(), 120_000);
    const onAbort = () => child.kill();
    signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.setEncoding("utf8").on("data", (d) => (out += d));
    child.on("error", () => resolve({ code: -1, out }));
    child.on("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve({ code, out });
    });
  });
}

// Scans files with Defender's engine without letting it remove anything (Cleaner asks the user first).
export async function defenderScan(files, { signal, onProgress } = {}) {
  const hits = new Map();
  for (const [i, file] of files.entries()) {
    signal?.throwIfAborted();
    const { code, out } = await mpScan(file, signal);
    if (code === 2) {
      const parsed = parseDefenderOutput(out);
      hits.set(file.toLowerCase(), parsed.find((p) => p.file.toLowerCase() === file.toLowerCase())?.name ?? parsed[0]?.name ?? "Detected by Microsoft Defender");
    }
    onProgress?.(i + 1, files.length);
  }
  return hits;
}

// ---------- online lookups (hash only) ----------
export async function malwareBazaar(sha256, key, { fetchImpl = globalThis.fetch, signal } = {}) {
  const res = await fetchImpl("https://mb-api.abuse.ch/api/v1/", {
    method: "POST",
    headers: { "Auth-Key": key, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ query: "get_info", hash: sha256 }).toString(),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000),
  });
  const data = await res.json().catch(() => ({}));
  if (data.query_status === "ok" && Array.isArray(data.data) && data.data.length) {
    const d = data.data[0];
    return { source: "malwarebazaar", found: true, label: d.signature || d.file_type || "known malware sample", tags: d.tags ?? [] };
  }
  if (data.query_status === "hash_not_found" || data.query_status === "no_results") return { source: "malwarebazaar", found: false };
  throw new Error(data.query_status ? `MalwareBazaar: ${data.query_status}` : `MalwareBazaar answered ${res.status}`);
}

export async function virusTotal(sha256, key, { fetchImpl = globalThis.fetch, signal } = {}) {
  const res = await fetchImpl(`https://www.virustotal.com/api/v3/files/${sha256}`, {
    headers: { "x-apikey": key },
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000),
  });
  if (res.status === 404) return { source: "virustotal", found: false };
  if (res.status === 429) throw new Error("VirusTotal: free limit reached (4 lookups a minute)");
  if (!res.ok) throw new Error(`VirusTotal answered ${res.status}`);
  const data = await res.json();
  const a = data?.data?.attributes ?? {};
  const stats = a.last_analysis_stats ?? {};
  const total = (stats.malicious ?? 0) + (stats.suspicious ?? 0) + (stats.undetected ?? 0) + (stats.harmless ?? 0);
  return {
    source: "virustotal",
    found: true,
    malicious: stats.malicious ?? 0,
    suspicious: stats.suspicious ?? 0,
    total,
    label: a.popular_threat_classification?.suggested_threat_label ?? null,
  };
}

export const virusTotalPage = (sha256) => `https://www.virustotal.com/gui/file/${sha256}`;
