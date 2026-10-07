import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

// Samples are built in memory, and suspicious text comes from the engine's own encoded patterns,
// so nothing that looks like malware is ever written to disk (where the real antivirus would react).
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "cleaner-protect-"));
process.env.CLEANER_HOME = path.join(sandbox, "data");
const { parsePE, entropy, importSet } = await import("../src/pe.js");
const { judge, examine, indicatorHits, searchable, PATTERNS, isCandidate, placeOf } = await import("../src/threat-rules.js");
const { parseCommand, winlogonOdd } = await import("../src/autostart.js");
const { EICAR_SHA256, loadBlocklist, parseDefenderOutput, malwareBazaar, virusTotal, trustHash, loadTrusted } = await import("../src/reputation.js");
const { quarantineFile, listQuarantine, restoreQuarantined, deleteQuarantined } = await import("../src/quarantine.js");
const { runThreatScan, scanPlan } = await import("../src/protect.js");

after(() => fs.rmSync(sandbox, { recursive: true, force: true }));

// A minimal 32-bit Windows program: one section holding an import table.
function buildPE({ imports = {}, write = false, sectionName = ".text", random = false, cert = false } = {}) {
  const rvaBase = 0x1000;
  const rawOff = 0x200;
  const data = Buffer.alloc(random ? 0x2000 : 0x1000);
  const dlls = Object.entries(imports);
  let cur = 20 * (dlls.length + 1);
  const plan = dlls.map(([dll, funcs]) => {
    const iltOff = cur;
    cur += 4 * (funcs.length + 1);
    return { dll, funcs, iltOff };
  });
  for (const p of plan) {
    p.nameOff = cur;
    data.write(`${p.dll}\0`, cur, "latin1");
    cur += p.dll.length + 1;
    p.funcOffs = p.funcs.map((f) => {
      const o = cur;
      data.write(`${f}\0`, cur + 2, "latin1");
      cur += 2 + f.length + 1;
      return o;
    });
  }
  plan.forEach((p, i) => {
    const d = i * 20;
    data.writeUInt32LE(rvaBase + p.iltOff, d);
    data.writeUInt32LE(rvaBase + p.nameOff, d + 12);
    data.writeUInt32LE(rvaBase + p.iltOff, d + 16);
    p.funcOffs.forEach((fo, j) => data.writeUInt32LE(rvaBase + fo, p.iltOff + j * 4));
  });
  if (random) crypto.randomBytes(data.length - cur - 16).copy(data, cur + 16);
  const total = rawOff + data.length;
  const buf = Buffer.alloc(total + (cert ? 64 : 0));
  buf.write("MZ", 0, "latin1");
  buf.writeUInt32LE(0x40, 0x3c);
  buf.writeUInt32LE(0x4550, 0x40);
  const coff = 0x44;
  buf.writeUInt16LE(0x14c, coff);
  buf.writeUInt16LE(1, coff + 2);
  buf.writeUInt16LE(224, coff + 16);
  buf.writeUInt16LE(0x0102, coff + 18);
  const opt = coff + 20;
  buf.writeUInt16LE(0x10b, opt);
  buf.writeUInt16LE(2, opt + 68);
  buf.writeUInt32LE(16, opt + 92);
  if (dlls.length) {
    buf.writeUInt32LE(rvaBase, opt + 104);
    buf.writeUInt32LE(20 * (dlls.length + 1), opt + 108);
  }
  if (cert) {
    buf.writeUInt32LE(total, opt + 128);
    buf.writeUInt32LE(64, opt + 132);
  }
  const sec = opt + 224;
  buf.write(sectionName, sec, "latin1");
  buf.writeUInt32LE(data.length, sec + 8);
  buf.writeUInt32LE(rvaBase, sec + 12);
  buf.writeUInt32LE(data.length, sec + 16);
  buf.writeUInt32LE(rawOff, sec + 20);
  buf.writeUInt32LE((0x60000020 | (write ? 0x80000000 : 0)) >>> 0, sec + 36);
  data.copy(buf, rawOff);
  return buf;
}

const facts = (over) => ({ path: "C:\\Users\\alex\\Downloads\\x.exe", name: "x.exe", ext: "exe", size: 9000, kind: "pe", pe: null, hits: {}, macro: false, pdf: null, zone: null, ...over });
const ids = (v) => v.findings.filter((f) => f.counted).map((f) => f.id).sort();

test("the PE reader finds sections, imports and an embedded signature", () => {
  const pe = parsePE(buildPE({ imports: { "KERNEL32.dll": ["CreateFileW", "ReadFile"], "user32.dll": ["MessageBoxW"] }, cert: true }));
  assert.ok(pe);
  assert.equal(pe.is64, false);
  assert.equal(pe.subsystem, "gui");
  assert.equal(pe.sections[0].name, ".text");
  assert.deepEqual(pe.imports["kernel32.dll"], ["CreateFileW", "ReadFile"]);
  assert.equal(pe.importCount, 3);
  assert.equal(pe.hasSignature, true);
  assert.ok(importSet(pe).has("messageboxw"));
  assert.equal(parsePE(Buffer.from("MZ not really a program")), null);
  assert.equal(parsePE(Buffer.from("hello")), null);
  assert.ok(entropy(crypto.randomBytes(4096)) > 7.8);
  assert.equal(entropy(Buffer.alloc(100)), 0);
});

test("injection and keylogging imports, writable code and packing are recognised", () => {
  const nasty = parsePE(buildPE({ imports: { "kernel32.dll": ["VirtualAllocEx", "WriteProcessMemory", "CreateRemoteThread"], "user32.dll": ["SetWindowsHookExW", "GetAsyncKeyState"] }, write: true }));
  const v = judge(facts({ pe: nasty }));
  assert.ok(ids(v).includes("injection"));
  assert.ok(ids(v).includes("keylogger"));
  assert.ok(ids(v).includes("writable-code"));
  assert.equal(v.level, "suspicious");
  const packed = parsePE(buildPE({ imports: { "kernel32.dll": ["LoadLibraryA"] }, random: true, sectionName: ".vmp0" }));
  const p = judge(facts({ pe: packed }));
  assert.ok(ids(p).includes("protector"));
  assert.ok(ids(p).includes("packed-code"));
  assert.ok(ids(p).includes("hidden-imports"));
});

test("UPX compression counts once, not as packed and self-rewriting code too", () => {
  const upx = parsePE(buildPE({ imports: { "kernel32.dll": ["LoadLibraryA", "GetProcAddress", "VirtualProtect", "ExitProcess", "Sleep"] }, random: true, write: true, sectionName: "UPX1" }));
  const v = judge(facts({ pe: upx }));
  assert.deepEqual(ids(v).filter((x) => ["upx", "packed-code", "writable-code"].includes(x)), ["upx"]);
});

test("a valid signature quiets the weak signals but not the deceptive ones", () => {
  const nasty = parsePE(buildPE({ imports: { "kernel32.dll": ["VirtualAllocEx", "WriteProcessMemory", "CreateRemoteThread"] } }));
  const signed = judge(facts({ pe: nasty }), { signer: { status: "valid", subject: "Contoso" } });
  assert.equal(signed.level, "clean");
  const trick = judge(facts({ name: "invoice.pdf.exe", path: "C:\\Users\\alex\\Downloads\\invoice.pdf.exe", pe: nasty }), { signer: { status: "valid" } });
  assert.deepEqual(ids(trick), ["double-extension"]);
  const broken = judge(facts({ pe: nasty }), { signer: { status: "invalid", subject: "Contoso" } });
  assert.ok(ids(broken).includes("signature-broken"));
});

test("disguised programs, double extensions and hidden characters", () => {
  const pe = parsePE(buildPE());
  assert.ok(ids(judge(facts({ name: "holiday.jpg", ext: "jpg", path: "C:\\Users\\alex\\Desktop\\holiday.jpg", pe }))).includes("disguised-program"));
  assert.ok(!ids(judge(facts({ name: "setup.tmp", ext: "tmp", path: "C:\\Users\\alex\\AppData\\Local\\Temp\\setup.tmp", pe }))).includes("odd-program-extension"));
  assert.equal(judge(facts({ name: "report\u202Efdp.exe", pe })).findings[0].id, "rtlo");
  assert.ok(ids(judge(facts({ name: "scan.pdf   .scr", ext: "scr", pe }))).includes("double-extension"));
});

test("scripts and shortcuts that download and run code are flagged", () => {
  const text = searchable(Buffer.from(`$x = 1; ${PATTERNS.downloadExec[0]} 'http://example.test/a'; ${PATTERNS.hidden[0]}`));
  const hits = indicatorHits(text);
  assert.ok(hits.downloadExec && hits.hidden);
  const script = judge(facts({ kind: "script", ext: "ps1", name: "update.ps1", hits }));
  assert.ok(ids(script).includes("download-exec"));
  const lnk = judge(facts({ kind: "lnk", ext: "lnk", name: "Invoice.lnk", hits, lnkRuns: "powershell" }));
  assert.ok(ids(lnk).includes("shortcut-command"));
  assert.equal(lnk.level, "suspicious");
  // UTF-16 text inside programs is found too
  const wide = searchable(Buffer.from(PATTERNS.evasion[2], "utf16le"));
  assert.ok(indicatorHits(wide).evasion);
  assert.deepEqual(indicatorHits(searchable(Buffer.from("just a normal readme about cats"))), {});
});

test("a cleanup script that names browser folders is not a stealer; one that also sends data out is", () => {
  const cleanup = indicatorHits(searchable(Buffer.from(`Remove-Item "${PATTERNS.browserData[0]}\\Default\\Cache"; # ${PATTERNS.browserData[4]}`)));
  assert.equal(judge(facts({ kind: "script", ext: "ps1", name: "cleaner-remove.ps1", hits: cleanup })).level, "clean");
  const stealer = indicatorHits(searchable(Buffer.from(`${PATTERNS.browserData[4]} ${PATTERNS.messaging[2]}`)));
  assert.ok(ids(judge(facts({ kind: "script", ext: "ps1", name: "x.ps1", hits: stealer }))).includes("stealer"));
});

test("macros, PDFs and downloads are judged by what they can do", () => {
  const doc = judge(facts({ kind: "zip", ext: "docm", name: "order.docm", macro: true, hits: { macroAuto: 1, macroShell: 1 }, zone: { id: 3, url: "https://mail.example.test/x" } }));
  assert.ok(ids(doc).includes("auto-macro") && ids(doc).includes("macro-shell") && ids(doc).includes("from-internet"));
  assert.equal(doc.level, "suspicious");
  assert.ok(ids(judge(facts({ kind: "pdf", ext: "pdf", pdf: { launch: true } }))).includes("pdf-launch"));
  assert.equal(judge(facts({ kind: "pdf", ext: "pdf", pdf: { js: false, auto: true, launch: false } })).level, "clean");
});

test("startup entries in writable folders and odd Winlogon values stand out", () => {
  const entry = { location: "HKCU\\...\\Run", command: "x", lolbin: null };
  const v = judge(facts({ path: "C:\\Users\\alex\\AppData\\Roaming\\upd\\svc.exe", name: "svc.exe", pe: parsePE(buildPE()) }), { signer: { status: "none" }, autostart: entry });
  assert.ok(ids(v).includes("autostart-writable"));
  assert.ok(winlogonOdd({ source: "winlogon", name: "Shell", command: "explorer.exe, C:\\Users\\Public\\x.exe" }));
  assert.ok(!winlogonOdd({ source: "winlogon", name: "Shell", command: "explorer.exe" }));
  assert.ok(!winlogonOdd({ source: "winlogon", name: "Userinit", command: "C:\\Windows\\system32\\userinit.exe," }));
});

test("startup commands resolve to the file that actually runs", () => {
  const exists = (p) => ["C:\\Program Files\\Some App\\app.exe", "C:\\Windows\\System32\\rundll32.exe"].includes(p);
  assert.equal(parseCommand("C:\\Program Files\\Some App\\app.exe --tray", exists).exe, "C:\\Program Files\\Some App\\app.exe");
  assert.equal(parseCommand('"C:\\Tools\\x.exe" -a', exists).exe, "C:\\Tools\\x.exe");
  const dll = parseCommand("rundll32.exe C:\\Users\\alex\\AppData\\Roaming\\a.dll,Start", exists);
  assert.equal(dll.host, "rundll32.exe");
  assert.equal(dll.target, "C:\\Users\\alex\\AppData\\Roaming\\a.dll");
  const ps = parseCommand(`"C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -nop -w hidden -c "${PATTERNS.downloadExec[0]}'http://x.test')"`, exists);
  assert.equal(ps.lolbin, "powershell.exe");
  assert.equal(parseCommand("", exists).exe, null);
});

test("file selection looks at risky types anywhere and sniffs documents where downloads land", () => {
  assert.equal(isCandidate("tool.exe", "D:\\Games\\tool.exe"), "risky");
  assert.equal(isCandidate("photo.jpg", "C:\\Users\\alex\\Downloads\\photo.jpg"), "sniff");
  assert.equal(isCandidate("photo.jpg", "C:\\Users\\alex\\Pictures\\photo.jpg"), null);
  // libraries and JavaScript only count where downloads land, not inside installed apps and editors
  assert.equal(isCandidate("ffmpeg.dll", "C:\\Users\\alex\\AppData\\Local\\Discord\\app-1.0\\ffmpeg.dll"), null);
  assert.equal(isCandidate("index.js", "C:\\Users\\alex\\.vscode\\extensions\\x\\index.js"), null);
  assert.equal(isCandidate("version.dll", "C:\\Users\\alex\\Downloads\\tool\\version.dll"), "risky");
  assert.equal(isCandidate("invoice.js", "C:\\Users\\alex\\Downloads\\invoice.js"), "risky");
  assert.ok(placeOf("C:\\Users\\alex\\AppData\\Local\\Temp\\a.exe").temp);
  assert.ok(placeOf("C:\\Users\\alex\\OneDrive\\Bureau\\a.exe").desktop);
  const quick = scanPlan("quick", { home: sandbox, env: {} });
  assert.ok(quick.every((j) => fs.existsSync(j.dir)));
});

test("online-only cloud files are recognised so they are never opened", async () => {
  const { notLocal } = await import("../src/walk.js");
  assert.equal(notLocal({ size: 5_000_000, blocks: 0 }), true, "a OneDrive placeholder: a size, but nothing on disk");
  assert.equal(notLocal({ size: 5_000_000, blocks: 9768 }), false);
  assert.equal(notLocal({ size: 300, blocks: 0 }), false, "tiny files can live in the file table");
  const real = path.join(sandbox, "real.bin");
  fs.writeFileSync(real, Buffer.alloc(64 * 1024, 1));
  assert.equal(notLocal(fs.statSync(real)), false, "a normal file on this disk is local");
});

test("hash lists: EICAR is built in, user lists add to it, trust is remembered", () => {
  const eicar = Buffer.from("WDVPIVAlQEFQWzRcUFpYNTQoUF4pN0NDKTd9JEVJQ0FSLVNUQU5EQVJELUFOVElWSVJVUy1URVNULUZJTEUhJEgrSCo=", "base64");
  assert.equal(crypto.createHash("sha256").update(eicar).digest("hex"), EICAR_SHA256);
  const list = path.join(sandbox, "company-blocklist.txt");
  fs.writeFileSync(list, `# comment\n${"ab".repeat(32)} Contoso.Dropper\nnot a hash\n`);
  const map = loadBlocklist([list]);
  assert.ok(map.has(EICAR_SHA256));
  assert.equal(map.get("ab".repeat(32)), "Contoso.Dropper");
  trustHash("cd".repeat(32), { path: "C:\\tools\\x.exe" });
  assert.ok(loadTrusted()["cd".repeat(32)]);
});

test("Defender's report is parsed without letting it remove anything", () => {
  const out = [
    "Scan starting...", "Scan finished.", "Scanning C:\\test\\eicar.com found 1 threats.", "",
    "<===========================LIST OF DETECTED THREATS==========================>",
    "----------------------------- Threat information ------------------------------",
    "Threat                  : Virus:DOS/EICAR_Test_File",
    "Resources               : 1 resources",
    "    file                : C:\\test\\eicar.com",
  ].join("\r\n");
  assert.deepEqual(parseDefenderOutput(out), [{ name: "Virus:DOS/EICAR_Test_File", file: "C:\\test\\eicar.com" }]);
  assert.deepEqual(parseDefenderOutput("Scan finished.\nNo threats"), []);
});

test("online lookups send a hash and read the answer", async () => {
  const json = (status, body) => async () => ({ status, ok: status < 400, json: async () => body });
  const hash = "ef".repeat(32);
  assert.deepEqual(await malwareBazaar(hash, "k", { fetchImpl: json(200, { query_status: "hash_not_found" }) }), { source: "malwarebazaar", found: false });
  const hit = await malwareBazaar(hash, "k", { fetchImpl: json(200, { query_status: "ok", data: [{ signature: "AgentTesla", tags: ["exe"] }] }) });
  assert.equal(hit.label, "AgentTesla");
  await assert.rejects(malwareBazaar(hash, "k", { fetchImpl: json(200, { query_status: "unknown_auth_key" }) }), /unknown_auth_key/);
  const vt = await virusTotal(hash, "k", { fetchImpl: json(200, { data: { attributes: { last_analysis_stats: { malicious: 40, suspicious: 1, undetected: 20, harmless: 0 }, popular_threat_classification: { suggested_threat_label: "trojan.x" } } } }) });
  assert.equal(vt.malicious, 40);
  assert.equal(vt.total, 61);
  assert.equal((await virusTotal(hash, "k", { fetchImpl: json(404, {}) })).found, false);
  let sent = null;
  await virusTotal(hash, "k", { fetchImpl: async (url, init) => ((sent = { url, init }), { status: 404, ok: false, json: async () => ({}) }) });
  assert.ok(sent.url.endsWith(hash) && !sent.init.body, "only the hash leaves the PC");
});

test("quarantine scrambles a file and restores it exactly", () => {
  const file = path.join(sandbox, "notes.txt");
  fs.writeFileSync(file, "some harmless text");
  const meta = quarantineFile(file, { reason: "test", sha256: "x" });
  assert.ok(!fs.existsSync(file));
  const payload = fs.readFileSync(path.join(process.env.CLEANER_HOME, "quarantine", meta.id, "payload.bin"));
  assert.notEqual(payload.toString(), "some harmless text");
  assert.equal(listQuarantine()[0].id, meta.id);
  fs.writeFileSync(file, "new file in the way");
  assert.throws(() => restoreQuarantined(meta.id), /back in its place/);
  fs.rmSync(file);
  restoreQuarantined(meta.id);
  assert.equal(fs.readFileSync(file, "utf8"), "some harmless text");
  assert.equal(listQuarantine().length, 0);
  const again = quarantineFile(file);
  deleteQuarantined(again.id);
  assert.equal(listQuarantine().length, 0);
  assert.throws(() => restoreQuarantined("../../etc"), /ENOENT|unknown/);
});

test("noise rules: document shortcuts are normal, and one weak sign is not a notice", () => {
  const recent = judge(facts({ kind: "lnk", ext: "lnk", name: "photo.png.lnk", path: "C:\\Users\\alex\\AppData\\Roaming\\Microsoft\\Windows\\Recent\\photo.png.lnk", lnkRuns: null }));
  assert.equal(recent.level, "clean", "Windows names its Recent-items shortcuts like this");
  const trick = judge(facts({ kind: "lnk", ext: "lnk", name: "invoice.pdf.lnk", lnkRuns: "powershell" }));
  assert.ok(ids(trick).includes("double-extension"), "a document-named shortcut that runs a shell is still a trick");
  const debuggerLike = parsePE(buildPE({ imports: { "kernel32.dll": ["VirtualAllocEx", "WriteProcessMemory", "CreateRemoteThread"] } }));
  assert.equal(judge(facts({ pe: debuggerLike, path: "D:\\Tools\\dbg.exe" })).level, "clean", "injection imports alone are everyday debuggers and games");
  const updater = judge(facts({ path: "D:\\Tools\\update.exe", pe: parsePE(buildPE()), hits: { downloadExec: 1 } }));
  assert.equal(updater.level, "clean", "programs that can download files are normal");
});

test("a real shortcut file on disk is recognized as a shortcut", async () => {
  // the shell link header: size 0x4C, then the link CLSID 00021401-0000-0000-C000-000000000046
  const header = Buffer.from("4c0000000114020000000000c000000000000046", "hex");
  const plain = path.join(sandbox, "photo.png.lnk");
  fs.writeFileSync(plain, Buffer.concat([header, Buffer.alloc(200), Buffer.from("C:\\Users\\alex\\Pictures\\photo.png", "utf16le")]));
  const doc = await examine(plain, { size: fs.statSync(plain).size });
  assert.equal(doc.kind, "lnk");
  assert.equal(doc.lnkRuns, null);
  assert.equal(judge(doc).level, "clean");
  const shell = path.join(sandbox, "invoice.pdf.lnk");
  fs.writeFileSync(shell, Buffer.concat([header, Buffer.alloc(200), Buffer.from("C:\\Windows\\System32\\cmd.exe /c start x", "utf16le")]));
  const trick = await examine(shell, { size: fs.statSync(shell).size });
  assert.equal(trick.lnkRuns, "cmd.exe");
  assert.ok(ids(judge(trick)).includes("double-extension"));
});

test("code projects keep their own scripts, and a second scan reuses fingerprints", async () => {
  const root = path.join(sandbox, "project");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "package.json"), "{}");
  fs.writeFileSync(path.join(root, "src", "tool.js"), `// ${PATTERNS.wsh[0]} ${PATTERNS.downloadExec[0]}`);
  fs.writeFileSync(path.join(root, "build.cmd"), "@echo build\r\n");
  const opts = { mode: "custom", roots: [root], autostart: false, useDefender: false, online: false, behavior: false, useYara: false, run: async () => "[]" };
  const first = await runThreatScan(opts);
  assert.equal(first.stats.inspected, 1, "the project's .js source is skipped, its .cmd is still looked at");
  const cacheFile = path.join(process.env.CLEANER_HOME, "file-cache.json");
  const cache = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
  const key = path.join(root, "build.cmd").toLowerCase();
  assert.match(cache[key].sha256, /^[a-f0-9]{64}$/);
  // poison the cached fingerprint: an unchanged file reuses it instead of hashing again
  cache[key].sha256 = "ab".repeat(32);
  fs.writeFileSync(cacheFile, JSON.stringify(cache));
  fs.writeFileSync(path.join(process.env.CLEANER_HOME, "blocklist.txt"), `${"ab".repeat(32)} Cached.Fingerprint\n`);
  const second = await runThreatScan(opts);
  assert.equal(second.results[0]?.detections[0]?.name, "Cached.Fingerprint");
  fs.rmSync(path.join(process.env.CLEANER_HOME, "blocklist.txt"));
});

test("a full scan of a folder: clean files stay quiet, a blocklisted file is a threat", async () => {
  const root = path.join(sandbox, "scanme");
  fs.mkdirSync(path.join(root, "sub"), { recursive: true });
  fs.writeFileSync(path.join(root, "hello.bat"), "@echo hello\r\n");
  fs.writeFileSync(path.join(root, "notes.md"), "nothing to see"); // .txt would be sniffed: the sandbox sits in %TEMP%
  fs.writeFileSync(path.join(root, "sub", "build.cmd"), "@echo building\r\n");
  const bad = crypto.createHash("sha256").update("@echo building\r\n").digest("hex");
  fs.writeFileSync(path.join(process.env.CLEANER_HOME, "blocklist.txt"), `${bad} Test.Blocklisted\n`);
  const events = [];
  const r = await runThreatScan({ mode: "custom", roots: [root], autostart: false, useDefender: false, online: false, behavior: false, run: async () => "[]", onEvent: (e) => events.push(e.type) });
  assert.equal(r.stats.inspected, 2, "the two scripts, not the notes");
  assert.equal(r.results.length, 1);
  assert.equal(r.results[0].severity, "threat");
  assert.equal(r.results[0].detections[0].source, "hash");
  assert.equal(r.results[0].detections[0].name, "Test.Blocklisted");
  assert.ok(events.includes("walk") || events.includes("walked"));
  assert.equal(r.engines.defender, false);
});
