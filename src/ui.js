import os from "node:os";

export const TTY = Boolean(process.stdout.isTTY);
// FORCE_COLOR wins over NO_COLOR, the same convention Node itself follows.
export const COLOR = process.env.FORCE_COLOR ? process.env.FORCE_COLOR !== "0" : !process.env.NO_COLOR && TTY;

export const shade = (n, text) => (COLOR ? `\x1b[38;5;${n}m${text}\x1b[39m` : String(text));
const bold = (text) => (COLOR ? `\x1b[1m${text}\x1b[22m` : String(text));

// Phosphor-green terminal palette. Amber marks "your call", red marks danger.
export const c = {
  hi: (t) => shade(83, t),
  green: (t) => shade(77, t),
  mid: (t) => shade(71, t),
  dim: (t) => shade(65, t),
  faint: (t) => shade(238, t),
  gray: (t) => shade(247, t),
  white: (t) => shade(255, t),
  amber: (t) => shade(214, t),
  red: (t) => shade(203, t),
  bold,
};

export const columns = () => Math.max(60, process.stdout.columns || 100);
export const stripAnsi = (text) => String(text).replace(/\x1b\[[0-9;]*m/g, "");
export const visible = (text) => stripAnsi(text).length;
const padEndVisible = (text, width) => text + " ".repeat(Math.max(0, width - visible(text)));

export function formatSize(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export function daysAgo(ms) {
  return Math.max(0, Math.floor((Date.now() - ms) / 86_400_000));
}

export function truncateMiddle(text, max) {
  text = String(text);
  if (max < 8 || text.length <= max) return text;
  const keep = max - 3;
  return text.slice(0, Math.ceil(keep / 2)) + "..." + text.slice(text.length - Math.floor(keep / 2));
}

const HOME = os.homedir();
export function shortPath(p) {
  return p && p.toLowerCase().startsWith(HOME.toLowerCase()) ? "~" + p.slice(HOME.length) : p;
}

// ANSI Shadow lettering, assembled per letter so every row lines up.
const LETTERS = {
  C: [" ██████╗", "██╔════╝", "██║     ", "██║     ", "╚██████╗", " ╚═════╝"],
  L: ["██╗     ", "██║     ", "██║     ", "██║     ", "███████╗", "╚══════╝"],
  E: ["███████╗", "██╔════╝", "█████╗  ", "██╔══╝  ", "███████╗", "╚══════╝"],
  A: [" █████╗ ", "██╔══██╗", "███████║", "██╔══██║", "██║  ██║", "╚═╝  ╚═╝"],
  N: ["███╗   ██╗", "████╗  ██║", "██╔██╗ ██║", "██║╚██╗██║", "██║ ╚████║", "╚═╝  ╚═══╝"],
  R: ["██████╗ ", "██╔══██╗", "██████╔╝", "██╔══██╗", "██║  ██║", "╚═╝  ╚═╝"],
};
const LOGO = [0, 1, 2, 3, 4, 5].map((row) => [..."CLEANER"].map((ch) => LETTERS[ch][row]).join(""));
const LOGO_SHADES = [120, 84, 83, 77, 71, 65];

export function banner(version) {
  console.log();
  if (columns() >= 64) {
    LOGO.forEach((row, i) => {
      const painted = COLOR
        ? row.replace(/█+/g, (m) => `\x1b[38;5;${LOGO_SHADES[i]}m${m}`).replace(/[╔╗╚╝═║]+/g, (m) => `\x1b[38;5;22m${m}`) + "\x1b[39m"
        : row;
      console.log("  " + painted);
    });
  } else {
    console.log("  " + c.hi(bold("cleaner")));
  }
  const sep = c.faint(" :: ");
  console.log("  " + c.dim(`v${version}`) + sep + c.dim("gemini-assisted junk hunter") + sep + c.dim("nothing is deleted until you say y"));
  console.log();
}

// systemd-style status lines: [  OK  ] label  detail
const TAGS = { ok: ["  OK  ", 83], warn: [" WARN ", 214], fail: [" FAIL ", 203], info: [" INFO ", 247], skip: [" SKIP ", 242] };
const LABEL = 16;

// Room left for the detail text after "[  OK  ] label           ".
export const detailRoom = () => columns() - LABEL - 12;

function statusLine(tag, color, label, detail) {
  return `${shade(242, "[")}${shade(color, tag)}${shade(242, "]")} ${c.white(label.padEnd(LABEL))} ${detail}`;
}

export function truncateEnd(text, max) {
  text = String(text);
  return text.length <= max ? text : text.slice(0, Math.max(0, max - 3)).trimEnd() + "...";
}

export function logLine(kind, label, detail = "") {
  const [tag, color] = TAGS[kind];
  console.log(statusLine(tag, color, label, c.gray(truncateMiddle(detail, detailRoom()))));
}

export function bar(fraction, width = 20) {
  const n = Math.round(Math.max(0, Math.min(1, fraction || 0)) * width);
  return c.hi("█".repeat(n)) + c.faint("░".repeat(width - n));
}

// A status line with a |/-\ spinner that becomes [  OK  ] when done.
export class Task {
  constructor(label) {
    this.label = label;
    this.detail = "";
    this.lastPaint = 0;
    this.timer = null;
    this.render(true);
  }

  render(force) {
    if (!TTY) return;
    const now = Date.now();
    if (!force && now - this.lastPaint < 80) return;
    this.lastPaint = now;
    const frame = "|/-\\"[Math.floor(now / 100) % 4];
    process.stdout.write("\r\x1b[2K" + statusLine(`  ${frame}   `, 83, this.label, this.detail));
  }

  // Callers shorten plain text with detailRoom() before colouring it.
  update(detail) {
    this.detail = detail;
    this.render(false);
  }

  animate() {
    if (TTY && !this.timer) this.timer = setInterval(() => this.render(true), 100);
    return this;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (TTY) process.stdout.write("\r\x1b[2K");
  }

  done(detail, kind = "ok") {
    this.stop();
    logLine(kind, this.label, detail);
  }
}

export function box(title, lines, width = Math.min(columns() - 4, 76)) {
  const inner = width - 2;
  const out = ["  " + c.faint("┌─ ") + c.hi(title) + " " + c.faint("─".repeat(Math.max(0, inner - title.length - 3)) + "┐")];
  for (const line of lines) out.push("  " + c.faint("│") + " " + padEndVisible(line, inner - 2) + " " + c.faint("│"));
  out.push("  " + c.faint("└" + "─".repeat(inner) + "┘"));
  console.log(out.join("\n"));
}

export function verdictTag(e) {
  if (e.status && e.status !== "pending") return shade(242, e.status.padEnd(9));
  return e.verdict === "remove" ? c.hi("safe".padEnd(9)) : c.amber("your call");
}

export function rule(label = "") {
  const width = Math.min(columns() - 4, 76);
  const text = label ? `── ${label} ` : "";
  console.log("  " + c.faint(text + "─".repeat(Math.max(0, width - text.length))));
}
