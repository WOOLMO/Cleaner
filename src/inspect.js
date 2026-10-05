import fs from "node:fs";
import path from "node:path";

const MB = 1024 * 1024;

// Names that suggest secrets. These files never get a preview and are never auto-removed.
const SENSITIVE_NAME = /(^\.env(\..*)?$|cred|secret|passw|token|api[-_]?key|private|id_rsa|id_ed25519|\.pem$|\.key$|\.pfx$|\.p12$|\.kdbx$|wallet|seed|\.ovpn$)/i;
const SENSITIVE_TEXT = /(password|passwd|api[_-]?key|secret|bearer\s|private key|BEGIN [A-Z ]*PRIVATE|aws_access|sk-[A-Za-z0-9]{10}|AIza[0-9A-Za-z_-]{20})/i;

const MAGIC = [
  ["4d5a", "Windows program or library"],
  ["504b0304", "ZIP-based archive (zip, docx, xlsx, apk, jar)"],
  ["52617221", "RAR archive"],
  ["377abcaf", "7-Zip archive"],
  ["25504446", "PDF document"],
  ["89504e47", "PNG image"],
  ["ffd8ff", "JPEG image"],
  ["47494638", "GIF image"],
  ["494433", "MP3 audio"],
  ["1a45dfa3", "Matroska or WebM video"],
  ["52494646", "RIFF media (wav, avi, webp)"],
  ["53514c697465", "SQLite database"],
  ["d0cf11e0", "Old Office document or MSI installer"],
  ["1f8b", "Gzip archive"],
  ["4f676753", "Ogg media"],
  ["7b5c727466", "RTF document"],
];

export function isSensitiveName(name) {
  return SENSITIVE_NAME.test(name);
}

function sniff(buf) {
  const hex = buf.subarray(0, 8).toString("hex");
  for (const [sig, label] of MAGIC) if (hex.startsWith(sig)) return label;
  if (buf.length >= 12 && buf.subarray(4, 8).toString("latin1") === "ftyp") return "MP4 or MOV video";
  return null;
}

function looksLikeText(buf) {
  if (!buf.length) return false;
  let control = 0;
  for (const byte of buf) {
    if (byte === 0) return false;
    if (byte < 9 || (byte > 13 && byte < 32)) control++;
  }
  return control / buf.length < 0.05;
}

export function redact(text) {
  return text
    .replace(/((?:api[_-]?key|secret|token|password|passwd|pwd|auth)["']?\s*[:=]\s*["']?)[^\s"',;]+/gi, "$1[redacted]")
    .replace(/[A-Za-z0-9_\-+/=]{32,}/g, "[redacted]")
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[email]");
}

// Reads the first 4 KB to tell what a file really is. A short, redacted preview is kept for small text files.
export function inspectFile(filePath, size, { allowPreview }) {
  const out = { fileType: null, preview: null, sensitive: isSensitiveName(path.basename(filePath)) };
  let buf;
  try {
    const fd = fs.openSync(filePath, "r");
    try {
      buf = Buffer.alloc(Math.min(4096, size));
      fs.readSync(fd, buf, 0, buf.length, 0);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return out;
  }

  out.fileType = sniff(buf);
  if (!out.fileType && looksLikeText(buf)) {
    out.fileType = "text";
    const text = buf.toString("utf8");
    if (SENSITIVE_TEXT.test(text)) out.sensitive = true;
    if (allowPreview && !out.sensitive && size <= 2 * MB) {
      out.preview = redact(text.replace(/\s+/g, " ").trim()).slice(0, 500);
    }
  }
  return out;
}
