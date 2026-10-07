import { Fragment, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Download, FolderOpen, History } from "lucide-react";
import { api } from "../api";
import { refreshActivity, useStore } from "../store";
import { Empty, PageHead, Segmented } from "../components/ui";
import { ActionIcon, actionLabel, describe } from "../components/activity";
import { baseName, dirName, formatSize, shortPath, timeAgo } from "../format";

type Filter = "all" | "removals" | "holds" | "organize" | "scans" | "settings";
const MATCH: Record<Filter, (a: string) => boolean> = {
  all: () => true,
  removals: (a) => a === "delete" || a === "purge",
  holds: (a) => a === "hold" || a === "restore",
  organize: (a) => a === "organize" || a === "organize-undo",
  scans: (a) => a === "scan" || a === "map",
  settings: (a) => a === "settings" || a === "export",
};

export function Activity() {
  const activity = useStore((s) => s.activity);
  const info = useStore((s) => s.info);
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    refreshActivity();
  }, []);

  const rows = activity.filter((a) => MATCH[filter](a.action));
  const count = (f: Filter) => activity.filter((a) => MATCH[f](a.action)).length;

  return (
    <div className="page">
      <PageHead
        title="Activity"
        sub="An append-only record of every scan and every change to the disk, from this app and the command line."
        actions={
          <>
            <button type="button" className="btn ghost" onClick={() => api.openPath("data")}>
              <FolderOpen />
              Open data folder
            </button>
            <button type="button" className="btn" onClick={() => api.exportActivity()}>
              <Download />
              Export CSV
            </button>
          </>
        }
      />
      <div className="toolbar">
        <Segmented<Filter>
          label="Filter activity"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All", count: count("all") },
            { value: "removals", label: "Removals", count: count("removals") },
            { value: "holds", label: "Hold and restore", count: count("holds") },
            { value: "organize", label: "Organize", count: count("organize") },
            { value: "scans", label: "Scans", count: count("scans") },
            { value: "settings", label: "Settings and exports", count: count("settings") },
          ]}
        />
        <span className="spacer" />
        {info && <span className="faint mono" style={{ fontSize: 11.5 }}>{shortPath(info.auditFile)}</span>}
      </div>
      <section className="card">
        {rows.length === 0 ? (
          <Empty icon={<History size={22} />} title="No activity yet" body="Scans, holds, deletions, restores and setting changes show up here as they happen." />
        ) : (
          <table className="grid-table">
            <thead>
              <tr>
                <th className="w" />
                <th>What happened</th>
                <th>When</th>
                <th>From</th>
                <th>Who</th>
                <th className="r">Size</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a, i) => (
                <Fragment key={`${a.time}-${i}`}>
                  <tr style={{ cursor: a.items?.length ? "pointer" : "default" }} onClick={() => a.items?.length && setOpen(open === i ? null : i)}>
                    <td className="w">
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        {a.items?.length ? open === i ? <ChevronDown size={14} className="faint" /> : <ChevronRight size={14} className="faint" /> : <span style={{ width: 14 }} />}
                        <ActionIcon action={a.action} />
                      </div>
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <span className="badge">{actionLabel(a.action)}</span>
                        <span>{describe(a)}</span>
                      </div>
                    </td>
                    <td className="muted" title={new Date(a.time).toLocaleString()}>
                      {timeAgo(a.time)}
                    </td>
                    <td>
                      <span className={`badge ${a.app === "cli" ? "violet" : "blue"}`}>{a.app === "cli" ? "Command line" : "Desktop"}</span>
                    </td>
                    <td className="muted mono" style={{ fontSize: 12 }}>
                      {a.user}@{a.machine}
                    </td>
                    <td className="r mono">{a.bytes ? formatSize(a.bytes) : ""}</td>
                  </tr>
                  {open === i && a.items && (
                    <tr className="expand">
                      <td colSpan={6}>
                        <ul className="path-list">
                          {a.items.slice(0, 40).map((it, j) => (
                            <li key={j}>
                              <span>{shortPath(it.path)}</span>
                              <span>{it.to ? `to ${baseName(dirName(it.to))}` : it.result}</span>
                              <span>{formatSize(it.size)}</span>
                            </li>
                          ))}
                          {a.items.length > 40 && <li className="faint">…and {a.items.length - 40} more</li>}
                        </ul>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
