import { useEffect, useMemo, useState } from "react";
import { ChevronRight, HardDrive, LayoutGrid, LoaderCircle, RefreshCw, Sparkles, Square } from "lucide-react";
import { api } from "../api";
import { startMap, toast, useStore } from "../store";
import { Empty, PageHead } from "../components/ui";
import { Treemap, type TreemapItem } from "../components/Treemap";
import { baseName, duration, formatCount, formatSize, shortPath, timeAgo } from "../format";
import type { Advice, MapChildren } from "../types";

const ADVICE_LABEL: Record<Advice, string> = { reclaim: "Can reclaim", check: "Worth a look", keep: "Keep" };
const ADVICE_BADGE: Record<Advice, string> = { reclaim: "green", check: "amber", keep: "blue" };

export function SpaceMap() {
  const map = useStore((s) => s.map);
  const running = useStore((s) => s.mapRunning);
  const progress = useStore((s) => s.mapProgress);
  const aiPending = useStore((s) => s.mapAiPending);
  const drives = useStore((s) => s.drives);
  const settings = useStore((s) => s.settings);
  const [root, setRoot] = useState(drives[0]?.root ?? "C:\\");
  const [trail, setTrail] = useState<MapChildren[]>([]);
  const [hot, setHot] = useState<string | null>(null);
  const [, tick] = useState(0);

  useEffect(() => setTrail([]), [map?.finishedAt]);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, [running]);

  const level = trail[trail.length - 1];
  const items = useMemo<TreemapItem[]>(() => {
    if (!map) return [];
    if (level) {
      const list: TreemapItem[] = level.children.map((c) => ({ key: c.path, name: c.name, size: c.size, tone: "plain" }));
      if (level.loose > 0) list.push({ key: `${level.path}::files`, name: "Files directly inside", size: level.loose, tone: "plain" });
      return list;
    }
    const units: TreemapItem[] = map.units.map((u) => {
      const ex = map.explained[u.path];
      return { key: u.path, name: u.loose ? `${shortPath(u.path)} (files)` : shortPath(u.path), label: ex?.label, size: u.size, tone: ex?.advice ?? "plain" };
    });
    const rest = map.stats.bytes - map.units.reduce((s, u) => s + u.size, 0);
    if (rest > 0) units.push({ key: "::rest", name: "Everything else", size: rest, tone: "plain" });
    return units;
  }, [map, level]);

  const open = async (item: TreemapItem) => {
    if (item.key.startsWith("::") || item.key.endsWith("::files")) return;
    const children = await api.mapChildren(item.key);
    if (!children) {
      toast("info", "Map the drive again to look inside", "Folder details are kept in memory for the current session only.");
      return;
    }
    if (!children.children.length) {
      toast("info", "Nothing more to open", `${baseName(item.key)} has no subfolders worth showing.`);
      return;
    }
    setTrail((t) => [...t, children]);
  };

  if (running && progress) {
    return (
      <div className="page">
        <PageHead title="Mapping the drive" sub="Sizing every folder. Nothing is changed." />
        <section className="card run">
          <div className="run-top">
            <span className="big">{formatCount(progress.files)}</span>
            <span className="unit">files · {formatSize(progress.bytes)}</span>
            <span className="elapsed mono">{duration(Date.now() - progress.startedAt)}</span>
          </div>
          <div className="sweep" />
          <div className="current truncate">{progress.current ? shortPath(progress.current) : ""}</div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
            <button type="button" className="btn" onClick={() => api.cancelMap()}>
              <Square size={13} />
              Cancel
            </button>
          </div>
        </section>
      </div>
    );
  }

  const picker = (
    <>
      <select className="input" value={root} onChange={(e) => setRoot(e.target.value)} aria-label="Drive">
        {drives.map((d) => (
          <option key={d.root} value={d.root}>
            Drive {d.letter}: · {formatSize(d.free)} free
          </option>
        ))}
      </select>
      <button type="button" className={map ? "btn" : "btn primary"} onClick={() => startMap(root)}>
        {map ? <RefreshCw /> : <LayoutGrid />}
        {map ? "Map again" : "Map drive"}
      </button>
    </>
  );

  if (!map) {
    return (
      <div className="page">
        <PageHead title="Space map" sub="Size every folder on a drive and learn what the big ones are." actions={picker} />
        <section className="card">
          <Empty
            icon={<HardDrive size={22} />}
            title="No map yet"
            body="Mapping reads folder sizes only. It takes a minute or two for a full drive and changes nothing."
            action={
              <button type="button" className="btn primary" onClick={() => startMap(root)}>
                <LayoutGrid />
                Map drive {root.slice(0, 2)}
              </button>
            }
          />
        </section>
      </div>
    );
  }

  const used = map.disk ? map.disk.total - map.disk.free : 0;
  const aiOff = !settings?.settings.aiEnabled || !settings.key.hasKey;

  return (
    <div className="page">
      <PageHead
        title="Space map"
        sub={`${map.root} · ${formatSize(map.stats.bytes)} mapped in ${duration(map.durationMs)} · ${timeAgo(map.finishedAt)}${map.stats.errors ? ` · ${map.stats.errors} folders need admin rights` : ""}`}
        actions={picker}
      />
      {map.disk && (
        <div className="card" style={{ padding: "12px 16px", marginBottom: 14, display: "flex", alignItems: "center", gap: 16 }}>
          <HardDrive size={17} className="muted" />
          <span className="num">
            <b>{formatSize(used)}</b> <span className="muted">used of {formatSize(map.disk.total)}</span>
          </span>
          <div className="meter" style={{ flex: 1 }}>
            <i className="used" style={{ width: `${(used / map.disk.total) * 100}%` }} />
          </div>
          <span className="num muted">{formatSize(map.disk.free)} free</span>
        </div>
      )}

      <div className="map-layout">
        <div>
          <div className="crumbs">
            <button type="button" onClick={() => setTrail([])}>
              {map.root}
            </button>
            {trail.map((t, i) => (
              <span key={t.path} style={{ display: "contents" }}>
                <ChevronRight />
                <button type="button" onClick={() => setTrail(trail.slice(0, i + 1))}>
                  {baseName(t.path)}
                </button>
              </span>
            ))}
            {!trail.length && <span className="faint" style={{ marginLeft: 8, fontSize: 12 }}>Click a block to look inside</span>}
          </div>
          <Treemap items={items} hot={hot} onHover={setHot} onOpen={open} />
        </div>

        <aside>
          <div className="legend-row" style={{ marginBottom: 12, minHeight: 32 }}>
            <span>
              <i style={{ background: "var(--accent)" }} />
              Can reclaim
            </span>
            <span>
              <i style={{ background: "var(--amber)" }} />
              Worth a look
            </span>
            <span>
              <i style={{ background: "var(--blue)" }} />
              Keep
            </span>
          </div>
          {aiPending && (
            <div className="card" style={{ padding: "10px 14px", marginBottom: 8, display: "flex", gap: 8, alignItems: "center" }}>
              <LoaderCircle size={15} className="spin" style={{ color: "var(--accent)" }} />
              <span className="muted">Gemini is explaining these folders…</span>
            </div>
          )}
          {aiOff && !Object.keys(map.explained).length && (
            <div className="card" style={{ padding: "10px 14px", marginBottom: 8 }}>
              <Sparkles size={14} style={{ verticalAlign: -2, color: "var(--accent)" }} /> <span className="muted">Turn on Gemini in Settings to get a plain-words explanation of each folder.</span>
            </div>
          )}
          <div className="units">
            {map.units.map((u) => {
              const ex = map.explained[u.path];
              return (
                <button
                  type="button"
                  key={u.path}
                  className={`unit${hot === u.path ? " hot" : ""}`}
                  onMouseEnter={() => setHot(u.path)}
                  onMouseLeave={() => setHot(null)}
                  onClick={() => !u.loose && open({ key: u.path, name: u.path, size: u.size, tone: "plain" })}
                >
                  <div className="top">
                    <b className="truncate">{ex?.label ?? baseName(u.path)}</b>
                    {ex && <span className={`badge ${ADVICE_BADGE[ex.advice]}`}>{ADVICE_LABEL[ex.advice]}</span>}
                    <span className="sz">{formatSize(u.size)}</span>
                  </div>
                  <div className="pth truncate">
                    {shortPath(u.path)}
                    {u.loose ? " · files directly inside" : ""}
                  </div>
                  {ex && <div className="tip">{ex.tip}</div>}
                </button>
              );
            })}
          </div>
        </aside>
      </div>
    </div>
  );
}
