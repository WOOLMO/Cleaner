import { Archive, ArchiveRestore, Download, LayoutGrid, Lock, ScanSearch, Settings, ShieldCheck, Trash2, Undo2, Wand2 } from "lucide-react";
import type { ReactNode } from "react";
import type { AuditEntry } from "../types";
import { displayRoot, formatCount, formatSize } from "../format";

const ICONS: Record<string, [ReactNode, string, string]> = {
  scan: [<ScanSearch />, "var(--blue-soft)", "var(--blue)"],
  map: [<LayoutGrid />, "var(--blue-soft)", "var(--blue)"],
  delete: [<Trash2 />, "var(--red-soft)", "var(--red)"],
  purge: [<Trash2 />, "var(--red-soft)", "var(--red)"],
  hold: [<Archive />, "var(--amber-soft)", "var(--amber)"],
  restore: [<ArchiveRestore />, "var(--accent-soft)", "var(--accent)"],
  export: [<Download />, "var(--surface-3)", "var(--text-2)"],
  settings: [<Settings />, "var(--surface-3)", "var(--text-2)"],
  organize: [<Wand2 />, "var(--violet-soft)", "var(--violet)"],
  "organize-undo": [<Undo2 />, "var(--surface-3)", "var(--text-2)"],
  "threat-scan": [<ShieldCheck />, "var(--accent-soft)", "var(--accent)"],
  quarantine: [<Lock />, "var(--red-soft)", "var(--red)"],
  "quarantine-restore": [<ArchiveRestore />, "var(--accent-soft)", "var(--accent)"],
  "quarantine-delete": [<Trash2 />, "var(--red-soft)", "var(--red)"],
};

export function ActionIcon({ action }: { action: string }) {
  const [icon, bg, fg] = ICONS[action] ?? ICONS.settings;
  return (
    <span className="act-ico" style={{ background: bg, color: fg }}>
      {icon}
    </span>
  );
}

const plural = (n: number | undefined, word: string) => `${formatCount(n ?? 0)} ${word}${n === 1 ? "" : "s"}`;

export function describe(a: AuditEntry): string {
  switch (a.action) {
    case "scan":
      return `Scanned ${(a.roots ?? []).map(displayRoot).join(", ")}, found ${plural(a.found, "item")}`;
    case "map":
      return `Mapped ${a.root ?? "a drive"}, ${formatSize(a.bytes ?? 0)} sized up`;
    case "delete":
      return `Deleted ${plural(a.count, "item")}`;
    case "hold":
      return `Moved ${plural(a.count, "item")} to the holding area`;
    case "restore":
      return `Restored ${plural(a.count, "item")} from the holding area`;
    case "purge":
      return `Purged ${plural(a.count, "held item")}`;
    case "export":
      return a.kind === "removal-script" ? "Wrote the removal script" : `Exported a ${String(a.kind ?? "report").replace("report-", "").toUpperCase()} report`;
    case "organize":
      return `Organized ${plural(a.count, "file")} in ${a.root ? displayRoot(a.root) : "a folder"}`;
    case "organize-undo":
      return `Undid organizing ${a.root ? displayRoot(a.root) : "a folder"}, ${plural(a.count, "file")} put back`;
    case "threat-scan": {
      const what = a.mode === "full" ? "Full threat scan" : a.mode === "custom" ? `Threat scan of ${(a.roots ?? []).map(displayRoot).join(", ")}` : "Quick threat scan";
      return a.threats ? `${what}: ${plural(a.threats, "threat")} found` : a.suspicious ? `${what}: ${plural(a.suspicious, "suspicious file")}` : `${what}: no threats`;
    }
    case "quarantine":
      return `Quarantined ${plural(a.count, "file")}`;
    case "quarantine-restore":
      return `Restored ${plural(a.count, "file")} from quarantine`;
    case "quarantine-delete":
      return `Deleted ${plural(a.count, "quarantined file")} for good`;
    case "settings":
      return a.changed?.includes("geminiKey") ? "Saved a Gemini API key" : `Changed ${a.changed?.join(", ") ?? "settings"}`;
    default:
      return a.action;
  }
}

export const actionLabel = (action: string) =>
  ({ scan: "Scan", map: "Map", organize: "Organize", "organize-undo": "Undo organize", "threat-scan": "Threat scan", quarantine: "Quarantine", "quarantine-restore": "Restore", "quarantine-delete": "Delete", delete: "Delete", purge: "Purge", hold: "Hold", restore: "Restore", export: "Export", settings: "Settings" })[action] ?? action;
