import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";

// Threat intel, YARA output, behavior rules and archives. No network: every fetch is faked, and samples
// are built in memory from the engine's own encoded patterns.
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "cleaner-intel-"));
process.env.CLEANER_HOME = path.join(sandbox, "data");
const { listZip, readZipEntry, extractZip } = await import("../src/zip.js");
const { FEEDS, updateIntel, loadIntel, intelStatus, hostsIn, hashLookup } = await import("../src/intel.js");
const { parseYaraOutput } = await import("../src/yara.js");
const { judgeProcess, analyzeBehavior, isPrivateIp, driverPath } = await import("../src/behavior.js");
const { PATTERNS, decodeEncodedCommand, inspectArchive, judge } = await import("../src/threat-rules.js");
const { runThreatScan } = await import("../src/protect.js");

after(() => fs.rmSync(sandbox, { recursive: true, force: true }));

// A small zip writer for the tests: stored or deflated entries, optionally marked encrypted.
function makeZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data, deflate = false, encrypted = false } of entries) {
    const body = deflate ? zlib.deflateRawSync(data) : data;
    const nameBuf = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(encrypted ? 1 : 0, 6);
    local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(encrypted ? 1 : 0, 8);
    central.writeUInt16LE(deflate ? 8 : 0, 10);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, body);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const fakeFetch = (routes) => async (url) => {
  const hit = Object.entries(routes).find(([k]) => url.includes(k));
  if (!hit) return { ok: false, status: 404, text: async () => "", json: async () => ({}) };
  const [status, body] = hit[1];
  return { ok: status < 400, status, text: async () => (typeof body === "string" ? body : JSON.stringify(body)), json: async () => body };
};

test("zip: entries are listed and read, stored or deflated, and extraction cannot escape its folder", () => {
  const file = path.join(sandbox, "a.zip");
  fs.writeFileSync(file, makeZip([
    { name: "readme.txt", data: Buffer.from("hello") },
    { name: "dir/../../evil.txt", data: Buffer.from("x".repeat(5000)), deflate: true },
  ]));
  const list = listZip(file);
  assert.deepEqual(list.entries.map((e) => e.name), ["readme.txt", "dir/../../evil.txt"]);
  assert.equal(readZipEntry(file, list.entries[1]).toString(), "x".repeat(5000));
  const out = extractZip(file, path.join(sandbox, "out"));
  assert.deepEqual(out.map((p) => path.basename(p)).sort(), ["evil.txt", "readme.txt"]);
  assert.ok(!fs.existsSync(path.join(sandbox, "evil.txt")));
  const notZip = path.join(sandbox, "not-a-zip.bin");
  fs.writeFileSync(notZip, "just some text, no zip directory at the end");
  assert.equal(listZip(notZip), null);
});

test("archives: programs, disguised names, locked zips and downloader scripts inside are flagged", () => {
  const script = `x ${PATTERNS.downloadExec[0]} "http://drop.example.test/p"`;
  const file = path.join(sandbox, "invoice.zip");
  fs.writeFileSync(file, makeZip([
    { name: "Invoice.pdf.js", data: Buffer.from(script) },
    { name: "notes.txt", data: Buffer.from("hi") },
  ]));
  const a = inspectArchive(file);
  assert.deepEqual(a.doubleExt, ["Invoice.pdf.js"]);
  assert.ok(a.hits.downloadExec);
  assert.deepEqual(a.hosts, ["drop.example.test"]);
  const v = judge({ path: file, name: "invoice.zip", ext: "zip", size: 100, kind: "zip", pe: null, hits: {}, macro: false, pdf: null, zone: null, archive: a });
  const ids = v.findings.map((f) => f.id);
  assert.ok(ids.includes("archive-double-extension") && ids.includes("archive-download-exec"));
  assert.equal(v.level, "suspicious");
  const locked = path.join(sandbox, "locked.zip");
  fs.writeFileSync(locked, makeZip([{ name: "setup.exe", data: Buffer.from("MZ"), encrypted: true }]));
  const l = judge({ path: locked, name: "locked.zip", ext: "zip", size: 100, kind: "zip", pe: null, hits: {}, archive: inspectArchive(locked) });
  assert.ok(l.findings.some((f) => f.id === "archive-locked"));
});

test("hidden PowerShell commands are decoded", () => {
  const inner = `${PATTERNS.downloadExec[0]}'http://x.example.test/a')`;
  const encoded = Buffer.from(inner, "utf16le").toString("base64");
  assert.equal(decodeEncodedCommand(`powershell.exe -nop -w hidden -enc ${encoded}`), inner);
  assert.equal(decodeEncodedCommand(`powershell -EncodedCommand ${encoded}`), inner);
  assert.equal(decodeEncodedCommand("powershell -File x.ps1"), null);
});

test("feeds are parsed, cached and loaded for offline lookups", async () => {
  const sha = "ab".repeat(32);
  const driverSha = "cd".repeat(32);
  const routes = {
    "bazaar.abuse.ch": [200, `# header\n${sha}\nnot-a-hash\n`],
    "urlhaus.abuse.ch": [200, "# URLhaus\n127.0.0.1\tbad.example.test\n127.0.0.1\tlocalhost\n"],
    "feodotracker.abuse.ch": [200, [{ ip_address: "203.0.113.9", port: 443, malware: "QakBot", status: "online" }]],
    "LOLDrivers": [200, [{ Id: "1", Category: "vulnerable driver", Tags: ["gdrv.sys"], KnownVulnerableSamples: [{ SHA256: driverSha.toUpperCase(), Filename: "gdrv.sys" }] }]],
  };
  const report = await updateIntel({ fetchImpl: fakeFetch(routes), force: true });
  assert.ok(Object.values(report).every((r) => r.ok), JSON.stringify(report));
  const intel = loadIntel();
  assert.ok(intel.hashes.has(sha));
  assert.ok(intel.hosts.has("bad.example.test") && !intel.hosts.has("localhost"));
  assert.equal(intel.ips.get("203.0.113.9").malware, "QakBot");
  assert.equal(intel.drivers.get(driverSha).malicious, false);
  assert.equal(intelStatus().urlhaus.count, 1);
  assert.equal(intelStatus().feodo.stale, false);
  const again = await updateIntel({ fetchImpl: async () => { throw new Error("should not refetch fresh feeds"); } });
  assert.deepEqual(again, {});
  assert.deepEqual(hostsIn("get https://Evil.Example.test:8080/a and http://x.test/b"), ["evil.example.test", "x.test"]);
  assert.equal(Object.keys(FEEDS).length, 4);
});

test("CIRCL hashlookup tells known-good from known-malicious", async () => {
  const h = "ef".repeat(32);
  assert.deepEqual(await hashLookup(h, { fetchImpl: fakeFetch({ hashlookup: [404, { message: "Non existing" }] }) }), { known: false });
  assert.equal((await hashLookup(h, { fetchImpl: fakeFetch({ hashlookup: [200, { FileName: "x.exe", KnownMalicious: "malshare.com" }] }) })).malicious, "malshare.com");
  const good = await hashLookup(h, { fetchImpl: fakeFetch({ hashlookup: [200, { FileName: "notepad.exe", source: "NSRL" }] }) });
  assert.equal(good.known, true);
  assert.equal(good.malicious, null);
});

test("YARA output with metadata is parsed", () => {
  const out = [
    // the format yara64 really prints: strings quoted, numbers as `key =80`
    'MAL_Stealer_Generic [author="Florian",description="Detects a stealer, \\"v2\\"",score =80] C:\\Users\\a\\Downloads\\x.exe',
    "SUSP_Packed_Exe C:\\Temp\\y.exe",
    "error scanning C:\\locked.exe: could not open file",
    'MALPEDIA_Win_Triback_Loader_Auto [description="autogenerated rule brought to you by yara-signator",score =75,tool="yara-signator v0.6.0"] C:\\Users\\a\\python.exe',
  ].join("\r\n");
  const hits = parseYaraOutput(out);
  assert.equal(hits.length, 3);
  assert.equal(hits[0].rule, "MAL_Stealer_Generic");
  assert.equal(hits[0].score, 80);
  assert.equal(hits[0].auto, false);
  assert.equal(hits[0].file, "C:\\Users\\a\\Downloads\\x.exe");
  assert.equal(hits[1].score, null);
  assert.equal(hits[2].auto, true, "machine-made rules are told apart");
});

test("behavior: fake system processes, Office starting shells, encoded commands, botnet servers", () => {
  const exists = () => true;
  const fake = judgeProcess({ pid: 10, name: "svchost.exe", path: "C:\\Users\\a\\AppData\\Local\\Temp\\svchost.exe", cmd: "svchost.exe" }, { exists });
  assert.ok(fake.findings.some((f) => f.id === "masquerade"));
  assert.equal(fake.severity, "suspicious");
  const real = judgeProcess({ pid: 11, name: "svchost.exe", path: "C:\\Windows\\System32\\svchost.exe", cmd: "svchost.exe -k netsvcs" }, { exists });
  assert.equal(real.severity, "clean");
  const longPath = judgeProcess({ pid: 14, name: "conhost.exe", path: "\\\\?\\C:\\WINDOWS\\system32\\conhost.exe" }, { exists });
  assert.equal(longPath.severity, "clean", "the \\\\?\\ prefix is not a disguise");
  const encoded = Buffer.from(`${PATTERNS.downloadExec[0]}'http://x.example.test')`, "utf16le").toString("base64");
  const macro = judgeProcess(
    { pid: 12, name: "powershell.exe", path: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", cmd: `powershell.exe -nop -w hidden -enc ${encoded}` },
    { parent: { name: "WINWORD.EXE" }, exists },
  );
  const ids = macro.findings.map((f) => f.id);
  assert.ok(ids.includes("office-child") && ids.includes("encoded-command") && ids.includes("download-exec"));
  const intel = { ips: new Map([["203.0.113.9", { malware: "QakBot" }]]), drivers: new Map() };
  const c2 = judgeProcess({ pid: 13, name: "update.exe", path: "C:\\Users\\a\\AppData\\Roaming\\update.exe" }, { connections: [{ state: "Established", remote: "203.0.113.9", rport: 443 }], intel, exists, signer: { status: "none" } });
  assert.equal(c2.severity, "threat");
  assert.match(c2.detections[0].name, /QakBot/);
  assert.ok(c2.findings.some((f) => f.id === "phones-out"));
  assert.ok(isPrivateIp("192.168.1.4") && isPrivateIp("172.20.0.1") && !isPrivateIp("8.8.8.8"));
  assert.match(driverPath("\\SystemRoot\\System32\\drivers\\gdrv.sys").toLowerCase(), /\\windows\\system32\\drivers\\gdrv\.sys$/);
});

test("behavior: the whole snapshot, with drivers checked against LOLDrivers", () => {
  const snap = {
    processes: [
      { pid: 100, ppid: 1, name: "explorer.exe", path: "C:\\Windows\\explorer.exe", cmd: "explorer.exe" },
      { pid: 200, ppid: 100, name: "lsass.exe", path: "C:\\Users\\Public\\lsass.exe", cmd: "lsass.exe" },
    ],
    connections: [{ pid: 200, state: "Listen", local: "0.0.0.0", lport: 4444 }],
    drivers: [{ name: "gdrv", path: "\\SystemRoot\\System32\\drivers\\gdrv.sys", display: "GIGABYTE driver" }, { name: "ok", path: "C:\\Windows\\System32\\drivers\\ok.sys" }],
  };
  const intel = { ips: new Map(), drivers: new Map([["11".repeat(32), { name: "gdrv.sys", malicious: false }]]) };
  const r = analyzeBehavior(snap, { intel, exists: () => true, hash: (f) => (f.toLowerCase().endsWith("gdrv.sys") ? "11".repeat(32) : "22".repeat(32)) });
  assert.equal(r.processes.length, 1);
  assert.equal(r.processes[0].name, "lsass.exe");
  assert.ok(r.processes[0].findings.some((f) => f.id === "listens"));
  assert.equal(r.drivers.length, 1);
  assert.equal(r.drivers[0].severity, "suspicious");
  assert.equal(r.stats.processes, 2);
});

test("the scan uses the cached feeds: a feed hash and a malware download site are threats", async () => {
  const root = path.join(sandbox, "Downloads");
  fs.mkdirSync(root, { recursive: true });
  const body = "@echo feed sample\r\n";
  fs.writeFileSync(path.join(root, "a.bat"), body);
  fs.writeFileSync(path.join(root, "b.bat"), "@echo from a bad site\r\n");
  fs.writeFileSync(path.join(root, "b.bat:Zone.Identifier"), "[ZoneTransfer]\r\nZoneId=3\r\nHostUrl=http://bad.example.test/b.bat\r\n");
  const sha = crypto.createHash("sha256").update(body).digest("hex");
  const intelDir = path.join(process.env.CLEANER_HOME, "intel");
  const cached = JSON.parse(fs.readFileSync(path.join(intelDir, "malwareBazaar.json"), "utf8"));
  cached.items.push(sha);
  fs.writeFileSync(path.join(intelDir, "malwareBazaar.json"), JSON.stringify(cached));
  const r = await runThreatScan({ mode: "custom", roots: [root], autostart: false, useDefender: false, online: false, behavior: false, run: async () => "[]" });
  const by = Object.fromEntries(r.results.map((x) => [x.name, x]));
  assert.equal(by["a.bat"].severity, "threat");
  assert.equal(by["a.bat"].detections[0].source, "malwarebazaar-feed");
  assert.equal(by["b.bat"].severity, "threat");
  assert.equal(by["b.bat"].detections[0].source, "urlhaus");
});
