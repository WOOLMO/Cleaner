import { useEffect, useState } from "react";
import {
  Boxes, Check, Copy, Download as DownloadIcon, FolderOpen, FolderPlus, Hourglass, LoaderCircle, Lock, Package, Play, ShieldCheck, Sparkles, Square, X,
} from "lucide-react";
import { api } from "../api";
import { cancelScan, saveSettings, startScan, store, useStore, type ScanProgress } from "../store";
import { PageHead, Toggle } from "../components/ui";
import { duration, formatCount, formatSize, shortPath } from "../format";
import { Results } from "./Results";

export function ScanPage() {
  const running = useStore((s) => s.scanRunning);
  const scan = useStore((s) => s.scan);
  const view = useStore((s) => s.scanView);
  if (running) return <Running />;
  if (scan && view === "results") return <Results />;
  return <Setup />;
}

const LOOKS = [
  { icon: <DownloadIcon />, title: "Unfinished downloads and temp files", body: "Browser downloads that never finished, Office lock files, temp data older than a week." },
  { icon: <Copy />, title: "Exact duplicates", body: "Copies confirmed byte for byte with SHA-1. Never inside games, apps or projects." },
  { icon: <Package />, title: "Caches that rebuild themselves", body: "App, browser, shader and package caches: pip, npm, pnpm, NuGet, Gradle." },
  { icon: <Boxes />, title: "Developer clutter", body: "node_modules, build output and virtual environments in your own projects." },
  { icon: <Hourglass />, title: "Leftovers", body: "Old app versions, crash dumps, extracted archives and installers you can re-download." },
];

function Setup() {
  const info = useStore((s) => s.info);
  const settings = useStore((s) => s.settings);
  const hasScan = useStore((s) => Boolean(s.scan));
  const [targets, setTargets] = useState<string[]>(() => (settings?.settings.targets.length ? settings.settings.targets : info ? [info.home] : []));
  if (!info || !settings) return null;
  const { aiEnabled, previews, largeMB } = settings.settings;
  const locks = settings.locks;
  const add = (paths: string[]) => setTargets((t) => [...t, ...paths.filter((p) => !t.some((x) => x.toLowerCase() === p.toLowerCase()))]);
  const quick = [
    { label: "User folder", path: info.home },
    { label: "Downloads", path: `${info.home}\\Downloads` },
    { label: "Desktop", path: `${info.home}\\Desktop` },
    { label: "Documents", path: `${info.home}\\Documents` },
  ].filter((q) => !targets.some((t) => t.toLowerCase() === q.path.toLowerCase()));

  const start = () => {
    saveSettings({ targets });
    startScan(targets);
  };

  return (
    <div className="page">
      <PageHead
        title="New scan"
        sub="Read-only. Cleaner looks, explains and waits for your decision."
        actions={
          hasScan && (
            <button type="button" className="btn ghost" onClick={() => store.set({ scanView: "results" })}>
              <X />
              Back to findings
            </button>
          )
        }
      />
      <div className="setup">
        <div style={{ display: "grid", gap: 14 }}>
          <section className="card">
            <div className="card-head">
              <h2>Folders to scan</h2>
              <span className="sub">{targets.length} selected</span>
            </div>
            <div className="card-body">
              <div className="targets">
                {targets.map((t) => (
                  <div className="target" key={t}>
                    <FolderOpen />
                    <span className="p mono truncate" title={t}>{shortPath(t)}</span>
                    <button type="button" className="btn sm ghost icon" aria-label={`Remove ${t}`} onClick={() => setTargets((x) => x.filter((p) => p !== t))}>
                      <X />
                    </button>
                  </div>
                ))}
                {!targets.length && <div className="muted" style={{ padding: "8px 2px" }}>Add at least one folder.</div>}
              </div>
              <div className="chips">
                <button type="button" className="chip" onClick={async () => add(await api.pickFolders())}>
                  <FolderPlus />
                  Choose folder
                </button>
                {quick.map((q) => (
                  <button type="button" className="chip" key={q.path} onClick={() => add([q.path])}>
                    + {q.label}
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <h2>Options</h2>
            </div>
            <div className="card-body">
              <Toggle
                label="Gemini review"
                locked={locks.aiEnabled}
                checked={aiEnabled && settings.key.hasKey}
                onChange={(v) => (settings.key.hasKey ? saveSettings({ aiEnabled: v }) : store.set({ page: "settings" }))}
                desc={
                  settings.key.hasKey
                    ? "Gemini double-checks each finding. It can veto a removal but never approve one alone."
                    : "Off until you add a free Gemini key in Settings. Local rules still work."
                }
              />
              <Toggle
                label="Short text previews"
                locked={locks.previews}
                checked={previews && aiEnabled}
                onChange={(v) => saveSettings({ previews: v })}
                desc="Lets Gemini read the first lines of small text files, with secrets, tokens and emails masked."
              />
              <div className="toggle">
                <span className="label">Ask about large files over</span>
                <select
                  className="input"
                  style={{ gridRow: "1 / span 2", gridColumn: 2, width: 110 }}
                  value={largeMB}
                  onChange={(e) => saveSettings({ largeMB: Number(e.target.value) })}
                >
                  {[100, 200, 500, 1000, 5000].map((mb) => (
                    <option key={mb} value={mb}>
                      {mb >= 1000 ? `${mb / 1000} GB` : `${mb} MB`}
                    </option>
                  ))}
                </select>
                <span className="desc">Big files no rule recognizes go to Gemini for a second look.</span>
              </div>
            </div>
          </section>

          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button type="button" className="btn primary lg" disabled={!targets.length} onClick={start}>
              <Play />
              Start scan
            </button>
            <span className="faint">
              {aiEnabled && settings.key.hasKey ? (
                <>
                  <Sparkles size={13} style={{ verticalAlign: -2 }} /> Names, sizes and dates{previews ? ", plus masked previews," : ""} go to Gemini.
                </>
              ) : (
                <>
                  <Lock size={13} style={{ verticalAlign: -2 }} /> Nothing leaves this PC.
                </>
              )}
            </span>
          </div>
        </div>

        <section className="card">
          <div className="card-head">
            <h2>What Cleaner looks for</h2>
          </div>
          <div className="card-body looks">
            {LOOKS.map((l) => (
              <div key={l.title}>
                {l.icon}
                <b>{l.title}</b>
                <span>{l.body}</span>
              </div>
            ))}
            <div>
              <ShieldCheck />
              <b>Never touched</b>
              <span>Windows, Program Files, .git folders, installed tools and anything that looks like a password or key.</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

const PHASES: { key: ScanProgress["phase"]; title: string }[] = [
  { key: "walk", title: "Walk the folders" },
  { key: "hash", title: "Confirm duplicates byte for byte" },
  { key: "inspect", title: "Look inside candidate files" },
  { key: "ai", title: "Gemini review" },
  { key: "finish", title: "Decide what is safe" },
];

function Running() {
  const p = useStore((s) => s.progress);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, []);
  if (!p) return null;
  const order = PHASES.findIndex((x) => x.key === p.phase);
  const detail = (key: ScanProgress["phase"]) => {
    switch (key) {
      case "walk":
        return `${formatCount(p.files)} files · ${formatSize(p.bytes)}`;
      case "hash":
        return p.copies !== null ? `${p.copies} copies found` : p.hashTotal ? `${formatSize(p.hashDone)} of ${formatSize(p.hashTotal)}` : "";
      case "inspect":
        return p.inspected !== null ? `${formatCount(p.inspected)} files read` : "";
      case "ai":
        return p.aiTotal ? `${p.aiDone} of ${p.aiTotal} items` : order > 3 ? "skipped" : "";
      default:
        return "";
    }
  };
  const bar = (key: ScanProgress["phase"]) =>
    key === "hash" && p.phase === "hash" && p.hashTotal ? p.hashDone / p.hashTotal : key === "ai" && p.phase === "ai" && p.aiTotal ? p.aiDone / p.aiTotal : null;

  return (
    <div className="page">
      <PageHead title="Scanning" sub="Read-only. You can keep using the app, the scan continues in the background." />
      <section className="card run">
        <div className="run-top">
          <span className="big">{formatCount(p.files)}</span>
          <span className="unit">files · {formatSize(p.bytes)}</span>
          <span className="elapsed mono">{duration(Date.now() - p.startedAt)}</span>
        </div>
        <div className="sweep" />
        <ol className="phases">
          {PHASES.map((ph, i) => {
            const state = i < order ? "done" : i === order ? "active" : "";
            const fraction = bar(ph.key);
            return (
              <li key={ph.key} className={`phase ${state}`}>
                <span className="dot">{state === "done" ? <Check strokeWidth={3} /> : state === "active" ? <LoaderCircle className="spin" /> : null}</span>
                <b>{ph.title}</b>
                <span className="mono muted">{detail(ph.key)}</span>
                {fraction !== null && (
                  <div className="meter thin">
                    <i style={{ width: `${fraction * 100}%` }} />
                  </div>
                )}
              </li>
            );
          })}
        </ol>
        <div className="current truncate">{p.current ? shortPath(p.current) : ""}</div>
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
          <button type="button" className="btn" onClick={() => cancelScan()}>
            <Square size={13} />
            Cancel
          </button>
        </div>
      </section>
    </div>
  );
}
