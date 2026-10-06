import fs from "node:fs";
import { formatSize } from "./ui.js";

// The database is a plain tab-separated text file, readable in Notepad and Excel.
const COLUMNS = ["id", "status", "verdict", "confidence", "size_bytes", "size", "category", "path", "reason"];

const tidy = (text) => String(text ?? "").replace(/[\t\r\n]+/g, " ").trim();

export function makeHeader({ roots, model }) {
  return [
    "# cleaner database. One item per line, columns separated by tabs.",
    "# verdict: remove = safe to delete, review = your call.",
    "# status: pending, removed, held, failed, missing. Change an item's status to keep and cleaner will leave it alone.",
    `# created: ${new Date().toISOString()}`,
    `# scanned: ${roots.join(" | ")}`,
    `# classified by: ${model}`,
  ];
}

export function writeDb(file, header, entries) {
  const rows = entries.map((e) =>
    [e.id, e.status, e.verdict, Number(e.confidence ?? 0).toFixed(2), e.size, formatSize(e.size), tidy(e.category), e.path, tidy(e.reason)].join("\t"),
  );
  fs.writeFileSync(file, [...header, COLUMNS.join("\t"), ...rows].join("\r\n") + "\r\n", "utf8");
}

export function readDb(file) {
  if (!fs.existsSync(file)) throw new Error(`No database at ${file}. Run "cleaner scan" first.`);
  const header = [];
  const entries = [];
  let columns = null;
  for (const line of fs.readFileSync(file, "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    if (line.startsWith("#")) {
      header.push(line);
      continue;
    }
    const cells = line.split("\t");
    if (!columns) {
      columns = cells;
      continue;
    }
    const row = Object.fromEntries(columns.map((name, i) => [name, cells[i] ?? ""]));
    entries.push({
      id: Number(row.id),
      status: row.status,
      verdict: row.verdict,
      confidence: Number(row.confidence),
      size: Number(row.size_bytes),
      category: row.category,
      path: row.path,
      reason: row.reason,
    });
  }
  return { header, entries };
}
