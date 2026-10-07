import fs from "node:fs";
import fsp from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { parsePE, importSet } from "./pe.js";

// Looks at one file the way an analyst would: what it really is, where it sits, where it came from,
// what it imports and what text it carries. Every finding has a weight and a plain-language label.
// Findings alone can make a file "suspicious"; only a known-bad hash or an antivirus detection makes a "threat".

// Search patterns are stored base64-encoded so this file is not itself mistaken for what it looks for.
const ENCODED = {"browserData":["XGdvb2dsZVxjaHJvbWVcdXNlciBkYXRh","XG1pY3Jvc29mdFxlZGdlXHVzZXIgZGF0YQ==","XGJyYXZlc29mdHdhcmVcYnJhdmUtYnJvd3Nlcg==","XG1vemlsbGFcZmlyZWZveFxwcm9maWxlcw==","bG9naW4gZGF0YQ==","bG9naW5zLmpzb24=","a2V5NC5kYg==","Y29va2llcy5zcWxpdGU="],"wallets":["d2FsbGV0LmRhdA==","XGV4b2R1c1xleG9kdXMud2FsbGV0","XGVsZWN0cnVtXHdhbGxldHM=","bmtiaWhmYmVvZ2FlYW9laGxlZm5rb2RiZWZncGdrbm4=","XGF0b21pY1xsb2NhbCBzdG9yYWdl","XGV0aGVyZXVtXGtleXN0b3Jl"],"messaging":["XHRlbGVncmFtIGRlc2t0b3BcdGRhdGE=","XGRpc2NvcmRcbG9jYWwgc3RvcmFnZVxsZXZlbGRi","ZGlzY29yZC5jb20vYXBpL3dlYmhvb2tz","ZGlzY29yZGFwcC5jb20vYXBpL3dlYmhvb2tz","YXBpLnRlbGVncmFtLm9yZy9ib3Q="],"downloadExec":["ZG93bmxvYWRzdHJpbmco","ZG93bmxvYWRmaWxlKA==","aW52b2tlLWV4cHJlc3Npb24=","aWV4KA==","aWV4ICg=","ZnJvbWJhc2U2NHN0cmluZw==","LWVuY29kZWRjb21tYW5k","IC1lbmMg","Yml0c2FkbWluIC90cmFuc2Zlcg==","Y2VydHV0aWwgLXVybGNhY2hl","Y2VydHV0aWwuZXhlIC11cmxjYWNoZQ==","c3RhcnQtYml0c3RyYW5zZmVy","bXNodGEgaHR0cA==","bXNodGEuZXhlIGh0dHA=","L2k6aHR0cA==","bmV0LndlYmNsaWVudA==","dXJsZG93bmxvYWR0b2ZpbGU="],"evasion":["c2V0LW1wcHJlZmVyZW5jZSAtZGlzYWJsZXJlYWx0aW1lbW9uaXRvcmluZw==","YWRkLW1wcHJlZmVyZW5jZSAtZXhjbHVzaW9ucGF0aA==","dnNzYWRtaW4gZGVsZXRlIHNoYWRvd3M=","dnNzYWRtaW4uZXhlIGRlbGV0ZSBzaGFkb3dz","c2hhZG93Y29weSBkZWxldGU=","d2JhZG1pbiBkZWxldGUgY2F0YWxvZw==","cmVjb3ZlcnllbmFibGVkIG5v","bmV0c2ggYWR2ZmlyZXdhbGwgc2V0IGFsbHByb2ZpbGVzIHN0YXRlIG9mZg=="],"ransom":["eW91ciBmaWxlcyBoYXZlIGJlZW4gZW5jcnlwdGVk","YWxsIHlvdXIgZmlsZXMgYXJlIGVuY3J5cHRlZA==","eW91ciBpbXBvcnRhbnQgZmlsZXMgYXJlIGVuY3J5cHRlZA==","ZGVjcnlwdCB5b3VyIGZpbGVz","ZmlsZXMgd2lsbCBiZSBsb3N0","dG8gcmVjb3ZlciB5b3VyIGZpbGVz"],"hidden":["LXdpbmRvd3N0eWxlIGhpZGRlbg==","IC13IGhpZGRlbg==","LW5vcCAtdyBoaWRkZW4=","Y3JlYXRlb2JqZWN0KCJ3c2NyaXB0LnNoZWxsIik="],"macroAuto":["YXV0b29wZW4=","ZG9jdW1lbnRfb3Blbg==","d29ya2Jvb2tfb3Blbg==","YXV0b19vcGVu","YXV0b2V4ZWM="],"macroShell":["d3NjcmlwdC5zaGVsbA==","c2hlbGwuYXBwbGljYXRpb24=","dXJsZG93bmxvYWR0b2ZpbGU=","bXN4bWwyLnhtbGh0dHA=","YWRvZGIuc3RyZWFt","cG93ZXJzaGVsbA=="],"wsh":["YWN0aXZleG9iamVjdA==","d3NjcmlwdC4=","Z2V0b2JqZWN0KA==","d3NjcmlwdC5zaGVsbA=="]};
export const PATTERNS = Object.fromEntries(Object.entries(ENCODED).map(([k, v]) => [k, v.map((s) => Buffer.from(s, "base64").toString("latin1"))]));

export const PE_EXT = new Set(["exe", "dll", "sys", "scr", "com", "cpl", "ocx", "drv", "efi", "mui", "node", "pyd", "ax", "acm", "tsp", "winmd", "xll", "msstyles"]);
export const SCRIPT_EXT = new Set(["ps1", "psm1", "bat", "cmd", "vbs", "vbe", "js", "jse", "wsf", "wsh", "hta"]);
const WSH_EXT = new Set(["vbs", "vbe", "js", "jse", "wsf", "wsh", "hta"]);
export const MACRO_EXT = new Set(["docm", "xlsm", "pptm", "dotm", "xltm", "xlam", "ppam", "doc", "xls", "ppt"]);
// Types worth a look anywhere. Everything else is only sniffed in the places downloads land.
export const RISKY_EXT = new Set([...PE_EXT, ...SCRIPT_EXT, ...MACRO_EXT, "msi", "msix", "appx", "lnk", "url", "jar", "pif", "iso", "img", "vhd", "vhdx", "pdf", "chm", "reg", "inf", "scf"]);
export const DISGUISE_EXT = new Set(["pdf", "doc", "docx", "xls", "xlsx", "txt", "jpg", "jpeg", "png", "gif", "bmp", "mp3", "mp4", "avi", "mov", "zip", "rar", "7z", "rtf", "csv", "html", "htm", "svg", "webp"]);
// PE files with these extensions are normal (installers unpack .tmp programs, games ship .bin and .dat).
const PE_QUIET_EXT = new Set(["tmp", "bin", "dat", "", "old", "bak", "dmp", "ax"]);
const PACKER_SECTIONS = new Set([".themida", ".winlice", ".vmp0", ".vmp1", ".vmp2", ".enigma1", ".enigma2", ".aspack", ".adata", ".mpress1", ".mpress2", ".petite", ".nsp0", ".nsp1", ".perplex", "pebundle", ".boom", ".ccg", ".charmve", ".yp"]);

const MAX_STRINGS = 8 * 1024 * 1024;
const MAX_HASH = 256 * 1024 * 1024;

export function extOf(name) {
  const m = /\.([^.\\/]+)$/.exec(name);
  return m ? m[1].toLowerCase() : "";
}

export function placeOf(filePath) {
  const p = filePath.toLowerCase();
  return {
    downloads: /\\(downloads|téléchargements|descargas|downloads?)\\/.test(p),
    desktop: /\\(desktop|bureau|escritorio)\\/.test(p),
    temp: p.includes("\\appdata\\local\\temp\\") || /^[a-z]:\\windows\\temp\\/.test(p),
    roaming: p.includes("\\appdata\\roaming\\"),
    localAppData: p.includes("\\appdata\\local\\") && !p.includes("\\appdata\\local\\temp\\"),
    startup: p.includes("\\start menu\\programs\\startup\\"),
    programData: /^[a-z]:\\programdata\\/.test(p),
    publicUser: /^[a-z]:\\users\\public\\/.test(p),
    programFiles: /^[a-z]:\\program files( \(x86\))?\\/.test(p),
    windows: /^[a-z]:\\windows\\/.test(p),
  };
}

// Text search over binary: UTF-16 strings are squeezed to ASCII by dropping zero bytes, then lower-cased.
export function searchable(buf) {
  const out = Buffer.allocUnsafe(buf.length);
  let n = 0;
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if (b !== 0) out[n++] = b >= 65 && b <= 90 ? b + 32 : b;
  }
  return out.toString("latin1", 0, n);
}

// In binaries, short patterns like "iex(" turn up by chance, so only patterns of 10+ characters count there.
export function indicatorHits(text, { binary = false } = {}) {
  const hits = {};
  for (const [group, list] of Object.entries(PATTERNS)) {
    const found = list.filter((p) => (!binary || p.length >= 10) && text.includes(p));
    if (found.length) hits[group] = found.length;
  }
  return hits;
}

function readZone(filePath) {
  try {
    const raw = fs.readFileSync(`${filePath}:Zone.Identifier`, "utf8");
    const id = Number(/ZoneId=(\d)/i.exec(raw)?.[1] ?? NaN);
    const url = /HostUrl=(\S+)/i.exec(raw)?.[1] ?? null;
    return Number.isFinite(id) ? { id, url: url && url !== "about:internet" ? url : null } : null;
  } catch {
    return null;
  }
}

export async function sha256File(filePath, size, signal) {
  if (size > MAX_HASH) return null;
  const hash = crypto.createHash("sha256");
  const handle = await fsp.open(filePath, "r");
  try {
    const buf = Buffer.allocUnsafe(1024 * 1024);
    for (;;) {
      signal?.throwIfAborted();
      const { bytesRead } = await handle.read(buf, 0, buf.length, null);
      if (!bytesRead) break;
      hash.update(buf.subarray(0, bytesRead));
    }
  } finally {
    await handle.close();
  }
  return hash.digest("hex");
}

// Gathers the facts about one file. Reads at most a few megabytes, never runs anything.
export async function examine(filePath, { size, mtime, signal } = {}) {
  const name = path.basename(filePath);
  const ext = extOf(name);
  const facts = { path: filePath, name, ext, size: size ?? 0, mtime: mtime ?? 0, kind: "other", pe: null, hits: {}, macro: false, pdf: null, zone: readZone(filePath), sha256: null, error: null };
  let fd;
  try {
    fd = fs.openSync(filePath, "r");
    if (size === undefined) facts.size = fs.fstatSync(fd).size;
    const head = Buffer.alloc(Math.min(4096, facts.size));
    fs.readSync(fd, head, 0, head.length, 0);
    const magic = head.subarray(0, 8).toString("hex");
    if (magic.startsWith("4d5a")) {
      facts.kind = "pe";
      facts.pe = parsePE(fd, facts.size);
      if (!facts.pe) facts.kind = "dos";
    } else if (magic.startsWith("4c0000000114020000")) facts.kind = "lnk";
    else if (magic.startsWith("504b0304")) facts.kind = "zip";
    else if (magic.startsWith("d0cf11e0")) facts.kind = ext === "msi" ? "msi" : "ole";
    else if (magic.startsWith("25504446")) facts.kind = "pdf";
    else if (SCRIPT_EXT.has(ext) || ext === "url" || ext === "reg" || ext === "inf" || ext === "scf") facts.kind = "script";

    // Text and strings, sized to the kind of file.
    // Office containers are only opened for macros when they are Office files; a .zip archive is not read.
    const office = MACRO_EXT.has(ext) || /^(docx|xlsx|pptx|dotx|xltx)$/.test(ext);
    const want = facts.kind === "script" || facts.kind === "lnk" ? Math.min(facts.size, 2 * 1024 * 1024)
      : facts.kind === "pe" || facts.kind === "dos" || facts.kind === "pdf" ? Math.min(facts.size, MAX_STRINGS)
      : facts.kind === "msi" ? Math.min(facts.size, 4 * 1024 * 1024)
      : (facts.kind === "zip" || facts.kind === "ole") && office ? Math.min(facts.size, 24 * 1024 * 1024)
      : 0;
    if (want) {
      const body = Buffer.alloc(want);
      fs.readSync(fd, body, 0, want, 0);
      const text = searchable(body);
      facts.hits = indicatorHits(text, { binary: facts.kind !== "script" && facts.kind !== "lnk" });
      // JavaScript only runs on double-click through Windows Script Host; Node and browser bundles are not scripts here.
      if (facts.kind === "script" && (ext === "js" || ext === "jse") && !facts.hits.wsh) facts.kind = "other";
      if (facts.kind === "zip") facts.macro = text.includes("vbaproject.bin");
      if (facts.kind === "ole") facts.macro = text.includes("_vba_project");
      if (facts.kind === "pdf") {
        facts.pdf = {
          js: text.includes("/javascript") || /\/js\s*[(<]/.test(text),
          auto: text.includes("/openaction") || text.includes("/aa"),
          launch: text.includes("/launch"),
          embedded: text.includes("/embeddedfile"),
        };
      }
      if (facts.kind === "script" || facts.kind === "lnk") {
        facts.longBase64 = /[a-z0-9+/]{400,}={0,2}/i.test(body.toString("latin1"));
        facts.charCodes = (text.match(/chr\(|charcode|fromcharcode/g) ?? []).length;
        if (facts.kind === "lnk") facts.lnkRuns = /powershell|pwsh|cmd\.exe|mshta|wscript|cscript|rundll32|regsvr32|certutil|bitsadmin/.exec(text)?.[0] ?? null;
      }
    }
  } catch (err) {
    facts.error = err.code ?? err.message;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  if (!facts.error) {
    try {
      facts.sha256 = await sha256File(filePath, facts.size, signal);
      // Test files like EICAR may carry trailing spaces or a newline; hash tiny files without them too.
      if (facts.size <= 128) {
        const body = fs.readFileSync(filePath).toString("latin1").replace(/[\s\x00]+$/, "");
        facts.trimmedSha256 = crypto.createHash("sha256").update(Buffer.from(body, "latin1")).digest("hex");
      }
    } catch (err) {
      if (signal?.aborted) throw err;
      facts.error = err.code ?? err.message;
    }
  }
  return facts;
}

// Turns facts into weighted findings. Pure, so it is easy to test and explain.
// signer: { status: "valid" | "invalid" | "untrusted" | "none" | "unknown", subject }
export function judge(facts, { signer = null, autostart = null } = {}) {
  const findings = [];
  const add = (id, weight, label, detail, { evenIfSigned = false } = {}) => findings.push({ id, weight, label, detail: detail ?? null, evenIfSigned });
  const place = placeOf(facts.path);
  const ext = facts.ext;
  const isPE = facts.kind === "pe";
  const userPlace = place.downloads || place.desktop || place.temp || place.startup || place.publicUser;

  // Names built to fool people.
  if (/[‮‭‎‏]/.test(facts.name)) add("rtlo", 6, "Uses a hidden character to fake its file extension", null, { evenIfSigned: true });
  if (/\.(pdf|docx?|xlsx?|pptx?|txt|rtf|jpe?g|png|gif|mp[34]|avi|mov|zip|rar|7z|csv)(\s|_)*\.(exe|scr|com|pif|bat|cmd|js|jse|vbs|vbe|hta|lnk|msi|wsf|ps1)$/i.test(facts.name)) {
    add("double-extension", 5, "Hides a program behind a document name", facts.name, { evenIfSigned: true });
  } else if (/\s{6,}\.\w+$/.test(facts.name)) add("padded-name", 4, "Pads its name with spaces to hide the real extension", null, { evenIfSigned: true });

  // What it is versus what it claims to be.
  if (isPE && !PE_EXT.has(ext) && ext !== "msi") {
    if (DISGUISE_EXT.has(ext)) add("disguised-program", 6, `A Windows program disguised as a .${ext} file`, null, { evenIfSigned: true });
    else if (!PE_QUIET_EXT.has(ext)) add("odd-program-extension", 2, `A Windows program with an unusual .${ext} extension`);
  }
  if (isPE && (ext === "scr" || ext === "pif") && !place.windows) add("screensaver", 3, `A .${ext} program, a classic way to slip malware past people`);
  if (facts.kind === "script" && WSH_EXT.has(ext) && userPlace) add("wsh-script", 2, "A script type Windows runs directly, common in email malware", null);
  if (facts.kind === "msi" && facts.hits.downloadExec) add("msi-download", 2, "An installer that downloads and runs code from the internet");

  // Where it sits and where it came from.
  // Portable tools often live in AppData\Roaming, so that place alone counts for less than Temp or Startup.
  if (isPE && !facts.pe?.dll && (place.temp || place.publicUser || place.startup || (place.roaming && !place.programFiles))) {
    add("exe-in-odd-place", place.roaming ? 1 : 2, place.startup ? "A program in your Startup folder" : place.temp ? "A program running from a temp folder" : place.publicUser ? "A program in the shared Public folder" : "A program installed into AppData\\Roaming");
  }
  if (facts.zone?.id >= 3 && (isPE || facts.kind === "script" || facts.kind === "lnk" || facts.macro)) {
    add("from-internet", facts.zone.id === 4 ? 2 : 1, facts.zone.id === 4 ? "Downloaded from a site Windows marks as untrusted" : "Downloaded from the internet", facts.zone.url);
  }

  // Signature.
  if (isPE && signer) {
    if (signer.status === "invalid") add("signature-broken", 5, "Its digital signature is broken: the file was changed after signing", signer.subject, { evenIfSigned: true });
    else if (signer.status === "untrusted") add("signature-untrusted", 2, "Signed with a certificate Windows does not trust", signer.subject);
    else if (signer.status === "none" && (userPlace || place.roaming || autostart)) add("unsigned", 1, "Not digitally signed by its publisher");
  }

  // Inside the program.
  if (isPE && facts.pe) {
    const pe = facts.pe;
    const names = pe.sections.map((s) => s.name.toLowerCase());
    if (names.some((n) => PACKER_SECTIONS.has(n))) add("protector", 2, "Wrapped in a commercial protector that hides its code", names.find((n) => PACKER_SECTIONS.has(n)));
    else if (names.includes("upx0") || names.includes("upx1")) add("upx", 1, "Compressed with UPX (used by tools and malware alike)");
    const hot = pe.sections.find((s) => s.exec && s.entropy > 7.3 && s.rawSize > 4096);
    if (hot && !pe.dotnet) add("packed-code", 2, "Its code section looks encrypted or compressed", `${hot.name || "(unnamed)"} entropy ${hot.entropy.toFixed(2)}`);
    if (pe.sections.some((s) => s.exec && s.write)) add("writable-code", 2, "Has code that can rewrite itself while running");
    const imp = importSet(pe);
    const has = (...f) => f.some((x) => imp.has(x));
    if (has("virtualallocex") && has("writeprocessmemory") && has("createremotethread", "ntcreatethreadex", "rtlcreateuserthread", "queueuserapc", "setthreadcontext")) {
      add("injection", 3, "Can write code into other running programs");
    }
    // Normal apps hook the keyboard for shortcuts; polling every key with GetAsyncKeyState next to a hook is the logger pattern.
    if (has("setwindowshookexa", "setwindowshookexw") && has("getasynckeystate")) add("keylogger", 2, "Can read keystrokes typed in other programs (also used for global hotkeys)");
    if (!pe.dotnet && pe.importCount <= 4 && pe.sections.some((s) => s.entropy > 7)) add("hidden-imports", 2, "Hides which Windows functions it uses");
  }

  // Text it carries.
  const h = facts.hits;
  const scriptLike = facts.kind === "script" || facts.kind === "lnk";
  // Cleanup scripts mention browser folders too; a script must also have a way to send data out.
  const exfil = h.wallets || h.messaging || h.downloadExec;
  if (h.browserData && (scriptLike ? exfil : h.browserData >= 2 || exfil)) add("stealer", 3, "Refers to saved browser passwords and cookies", null);
  if (h.wallets) add("wallets", 2, "Refers to cryptocurrency wallet files");
  if (h.messaging) add("messaging-tokens", 3, "Refers to Discord or Telegram sessions or bot webhooks");
  if (h.downloadExec && facts.kind !== "msi") add("download-exec", scriptLike ? 3 : 2, "Downloads and runs code from the internet");
  if (h.evasion) add("evasion", 4, "Turns off security features or deletes backups", null, { evenIfSigned: true });
  if (h.ransom >= 2) add("ransom-note", 4, "Contains ransom note wording", null, { evenIfSigned: true });
  if (scriptLike && h.hidden) add("hidden-window", 1, "Runs with its window hidden");
  if (scriptLike && facts.longBase64) add("encoded-payload", 2, "Carries a long encoded block of data");
  if (scriptLike && facts.charCodes >= 30) add("obfuscated", 2, "Builds its code from character codes to hide it");
  if (facts.kind === "lnk" && facts.lnkRuns && (h.downloadExec || h.hidden || facts.longBase64)) add("shortcut-command", 4, `A shortcut that secretly runs ${facts.lnkRuns}`);

  // Documents.
  if (facts.macro) {
    add("macros", 1, "Contains Office macros");
    if (h.macroAuto) add("auto-macro", 2, "Its macros run as soon as the document opens");
    if (h.macroShell) add("macro-shell", 2, "Its macros can start programs or download files");
  }
  if (facts.pdf?.launch) add("pdf-launch", 3, "A PDF that tries to launch a program");
  else if (facts.pdf?.js && facts.pdf.auto) add("pdf-js", 2, "A PDF that runs JavaScript when opened");

  // Something that starts with Windows.
  if (autostart) {
    const writable = place.temp || place.roaming || place.localAppData || place.downloads || place.desktop || place.publicUser || place.programData;
    if (writable && signer?.status !== "valid") add("autostart-writable", 3, "Starts with Windows from a folder any program can write to", autostart.location);
    if (autostart.lolbin) add("autostart-lolbin", 4, `Starts with Windows through ${autostart.lolbin} with a suspicious command`, autostart.command, { evenIfSigned: true });
  }

  const trusted = signer?.status === "valid";
  let score = 0;
  for (const f of findings) {
    f.counted = !trusted || f.evenIfSigned;
    if (f.counted) score += f.weight;
  }
  return { findings, score, level: score >= 6 ? "suspicious" : score >= 3 ? "notice" : "clean" };
}

// Whether a file deserves a closer look at all.
export function isCandidate(name, filePath) {
  const ext = extOf(name);
  if (RISKY_EXT.has(ext)) return "risky";
  const place = placeOf(filePath);
  if ((place.downloads || place.desktop || place.temp || place.startup) && (DISGUISE_EXT.has(ext) || /[‮]/.test(name))) return "sniff";
  if (place.startup) return "startup";
  return null;
}
