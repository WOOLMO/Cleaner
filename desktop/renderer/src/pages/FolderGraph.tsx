import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, ChevronRight, Eye, EyeOff, File, Folder, FolderOpen, FolderTree, HardDrive, Home, LoaderCircle, Lock, RefreshCw, Search, X } from "lucide-react";
import { api } from "../api";
import { collapseGraph, expandGraph, loadGraph, store, useStore } from "../store";
import { ForceGraph, kindColor, type GNode, type GraphLayout } from "../components/ForceGraph";
import { Empty, PageHead, Segmented } from "../components/ui";
import { baseName, displayRoot, formatCount, formatSize, shortPath } from "../format";
import type { GraphNode } from "../types";

export const KIND_LABELS: Record<string, string> = {
  documents: "Documents", spreadsheets: "Spreadsheets", presentations: "Slides", images: "Images", screenshots: "Screenshots",
  videos: "Videos", audio: "Audio", archives: "Archives", installers: "Installers", "disk-images": "Disk images", code: "Code",
  design: "Design", "3d": "3D", fonts: "Fonts", ebooks: "Ebooks", other: "Other",
};

interface Index {
  byId: Map<string, GraphNode>;
  parent: Map<string, string | null>;
}

function flatten(tree: GraphNode | null, showHidden: boolean): { nodes: GNode[]; index: Index } {
  const nodes: GNode[] = [];
  const index: Index = { byId: new Map(), parent: new Map() };
  if (!tree) return { nodes, index };
  const visit = (n: GraphNode, parent: string | null) => {
    if (parent && n.hidden && !showHidden) return;
    index.byId.set(n.path, n);
    index.parent.set(n.path, parent);
    nodes.push({
      id: n.path,
      parent,
      label: n.name || n.path,
      kind: parent ? n.kind : "root",
      size: n.size,
      count: n.kind === "more" ? (n.dirs ?? 0) + (n.files ?? 0) : n.count,
      category: n.category,
      tone: n.flag === "remove" ? "accent" : n.flag === "review" ? "amber" : undefined,
      open: Boolean(n.children?.length),
    });
    for (const c of n.children ?? []) visit(c, n.path);
  };
  visit(tree, null);
  return { nodes, index };
}

const theme = () => (document.documentElement.dataset.theme === "light" ? "light" : "dark");

export function FolderGraph() {
  const info = useStore((s) => s.info);
  const graph = useStore((s) => s.graph);
  const drives = useStore((s) => s.drives);
  const scan = useStore((s) => s.scan);
  const [layout, setLayout] = useState<GraphLayout>("web");
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);

  useEffect(() => {
    if (!graph.tree && !graph.loading && info) loadGraph(info.home);
  }, []);
  useEffect(() => {
    setSelected(null);
    setKind(null);
    setQuery("");
  }, [graph.root]);

  const { nodes, index } = useMemo(() => flatten(graph.tree, showHidden), [graph.tree, showHidden]);
  const hiddenCount = useMemo(() => {
    let n = 0;
    const visit = (g: GraphNode) => g.children?.forEach((c) => (c.hidden ? n++ : visit(c)));
    if (graph.tree) visit(graph.tree);
    return n;
  }, [graph.tree]);

  const emphasis = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2 && !kind) return null;
    const out = new Set<string>();
    for (const n of nodes) {
      if (n.kind === "root") continue;
      if (q.length >= 2 && !n.label.toLowerCase().includes(q)) continue;
      if (kind && !(kind === "folders" ? n.kind === "dir" : n.kind === "file" && (n.category ?? "other") === kind)) continue;
      out.add(n.id);
    }
    return out;
  }, [nodes, query, kind]);

  const stats = useMemo(() => {
    const kinds = new Map<string, number>();
    let dirs = 0, files = 0, bytes = 0, flagged = 0;
    for (const n of nodes) {
      if (n.kind === "dir") dirs++;
      if (n.kind === "file") {
        files++;
        bytes += n.size ?? 0;
        kinds.set(n.category ?? "other", (kinds.get(n.category ?? "other") ?? 0) + 1);
      }
      if (n.tone) flagged++;
    }
    return { dirs, files, bytes, flagged, kinds: [...kinds].sort((a, b) => b[1] - a[1]) };
  }, [nodes]);

  const click = (n: GNode) => {
    setSelected(n.id);
    const node = index.byId.get(n.id);
    if (!node) return;
    if (n.kind === "dir") {
      if (node.children?.length && !node.partial) collapseGraph(node.path);
      else if ((node.count ?? 0) > 0 && !node.locked) expandGraph(node.path);
    } else if (n.kind === "more") {
      const parent = index.parent.get(n.id);
      const p = parent ? index.byId.get(parent) : null;
      if (p?.partial) expandGraph(p.path);
    }
  };

  // Screenshot mode drives the page: open a folder, switch layout, search.
  useEffect(() => {
    const onDemo = (e: Event) => {
      const d = (e as CustomEvent<{ open?: string; layout?: GraphLayout; query?: string }>).detail;
      const node = d.open ? index.byId.get(d.open) : null;
      if (d.open && node) click({ id: d.open, parent: index.parent.get(d.open) ?? null, label: node.name, kind: "dir" });
      if (d.layout) setLayout(d.layout);
      if (d.query !== undefined) setQuery(d.query);
    };
    window.addEventListener("cleaner:graph-demo", onDemo);
    return () => window.removeEventListener("cleaner:graph-demo", onDemo);
  }, [index]);

  const tooltip = (n: GNode) => {
    const node = index.byId.get(n.id);
    const flag = node?.flag === "remove" ? " · safe to remove" : node?.flag === "review" ? " · your call" : "";
    if (n.kind === "file") return { title: n.label, sub: `${formatSize(n.size ?? 0)} · ${KIND_LABELS[n.category ?? "other"] ?? "File"}${flag}` };
    if (n.kind === "more") return { title: n.label, sub: `${node?.dirs ?? 0} folders and ${node?.files ?? 0} files not drawn` };
    if (node?.locked) return { title: n.label, sub: "Needs admin rights" };
    const count = node?.count ?? 0;
    const hint = n.kind === "root" ? "" : node?.children?.length && !node.partial ? " · click to fold" : count ? " · click to open" : "";
    return { title: n.label, sub: `${formatCount(count)} item${count === 1 ? "" : "s"}${flag}${hint}` };
  };

  const pickRoot = async () => {
    const dir = await api.pickFolder("Choose a folder to map");
    if (dir) loadGraph(dir);
  };

  const sel = selected ? index.byId.get(selected) : null;
  const crumbs: GraphNode[] = [];
  for (let p: string | null | undefined = selected; p; p = index.parent.get(p)) {
    const n = index.byId.get(p);
    if (n) crumbs.unshift(n);
  }
  const entry = sel && scan ? scan.entries.find((e) => e.path.toLowerCase() === sel.path.toLowerCase() && e.status === "pending") : null;

  return (
    <div className="page page-wide">
      <PageHead
        title="Folder graph"
        sub="How your folders and files connect. Click a folder to open it, drag to rearrange, scroll to zoom."
        actions={
          <>
            <Segmented
              label="Layout"
              value={layout}
              onChange={setLayout}
              options={[
                { value: "web", label: "Web" },
                { value: "rings", label: "Rings" },
              ]}
            />
            {info && (
              <button type="button" className="btn" aria-pressed={graph.root === info.home} onClick={() => loadGraph(info.home)}>
                <Home />
                User folder
              </button>
            )}
            {drives.slice(0, 2).map((d) => (
              <button key={d.root} type="button" className="btn" onClick={() => loadGraph(d.root)}>
                <HardDrive />
                {d.letter}:
              </button>
            ))}
            <button type="button" className="btn" onClick={pickRoot}>
              <FolderOpen />
              Choose folder
            </button>
          </>
        }
      />

      <div className="graph-layout">
        <section className="card graph-card">
          {graph.tree ? (
            <ForceGraph nodes={nodes} layout={layout} selected={selected} emphasis={emphasis} onNodeClick={click} onNodeOpen={(n) => n.kind !== "more" && api.reveal(n.id)} tooltip={tooltip} fitKey={graph.root ?? undefined}>
              <div className="fg-search input-icon">
                <Search />
                <input className="input" placeholder="Find in the graph" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setQuery("")} />
                {query && (
                  <button type="button" className="btn ghost icon sm fg-clear" title="Clear" onClick={() => setQuery("")}>
                    <X />
                  </button>
                )}
              </div>
              <div className="fg-legend">
                <button type="button" className="pill" aria-pressed={kind === "folders"} onClick={() => setKind(kind === "folders" ? null : "folders")}>
                  <i className="ring" />
                  Folders <span>{formatCount(stats.dirs)}</span>
                </button>
                {stats.kinds.slice(0, 8).map(([k, n]) => (
                  <button key={k} type="button" className="pill" aria-pressed={kind === k} onClick={() => setKind(kind === k ? null : k)}>
                    <i style={{ background: kindColor(k, theme()) }} />
                    {KIND_LABELS[k] ?? k} <span>{formatCount(n)}</span>
                  </button>
                ))}
                {hiddenCount > 0 && (
                  <button type="button" className="pill" aria-pressed={showHidden} onClick={() => setShowHidden(!showHidden)} title="Dot-folders, AppData and other hidden items">
                    {showHidden ? <Eye /> : <EyeOff />}
                    Hidden items <span>{formatCount(hiddenCount)}</span>
                  </button>
                )}
                {stats.flagged > 0 && (
                  <span className="pill static">
                    <i className="ring accent" />
                    Found by your last scan
                  </span>
                )}
              </div>
              {(graph.loading || graph.expanding) && (
                <div className="fg-busy">
                  <LoaderCircle className="spin" size={14} />
                  {graph.loading ? "Reading folders" : `Opening ${baseName(graph.expanding ?? "")}`}
                </div>
              )}
            </ForceGraph>
          ) : graph.loading ? (
            <div className="graph-loading">
              <FolderTree size={26} className="pulse" />
              <span className="muted">Reading your folders</span>
            </div>
          ) : (
            <Empty icon={<FolderTree size={22} />} title="Pick a folder to map" body="The graph draws its folders and files, then opens deeper as you click." action={info && <button type="button" className="btn primary" onClick={() => loadGraph(info.home)}>Map my user folder</button>} />
          )}
        </section>

        <aside className="graph-side">
          <section className="card">
            <div className="card-body graph-stats">
              <div>
                <span className="k">Showing</span>
                <b className="num">{formatCount(stats.dirs + stats.files)}</b>
                <span className="faint">{formatCount(stats.dirs)} folders, {formatCount(stats.files)} files</span>
              </div>
              <div>
                <span className="k">Files drawn</span>
                <b className="num">{formatSize(stats.bytes)}</b>
                <span className="faint truncate" title={graph.root ?? ""}>in {graph.root ? displayRoot(graph.root) : "…"}</span>
              </div>
            </div>
          </section>

          <section className="card graph-detail">
            {sel ? (
              <>
                <div className="gd-head">
                  <span className="gd-icon" style={sel.kind === "file" ? { color: kindColor(sel.category, theme()) } : undefined}>
                    {sel.kind === "file" ? <File size={18} /> : sel.locked ? <Lock size={18} /> : <Folder size={18} />}
                  </span>
                  <div className="truncate">
                    <h3 className="truncate" title={sel.name}>{sel.name || sel.path}</h3>
                    <span className="muted">
                      {sel.kind === "file"
                        ? `${formatSize(sel.size ?? 0)} · ${KIND_LABELS[sel.category ?? "other"]}`
                        : sel.kind === "more"
                          ? `${sel.dirs ?? 0} folders and ${sel.files ?? 0} files`
                          : `${formatCount(sel.count ?? 0)} items inside`}
                    </span>
                  </div>
                </div>
                {sel.flag && (
                  <div className={`gd-flag ${sel.flag === "remove" ? "green" : "amber"}`}>
                    {sel.flag === "remove" ? "Safe to remove" : "Your call"}
                    {entry && <span>{entry.reason}</span>}
                  </div>
                )}
                <div className="gd-label">Connection</div>
                <ol className="crumbs">
                  {crumbs.map((c, i) => (
                    <li key={c.path}>
                      {i > 0 && <ChevronRight size={12} className="faint" />}
                      <button type="button" className={c.path === selected ? "on" : ""} onClick={() => setSelected(c.path)}>
                        {i === 0 ? displayRoot(c.path) : c.name}
                      </button>
                    </li>
                  ))}
                </ol>
                {sel.kind !== "more" && <div className="gd-path mono selectable">{sel.path}</div>}
                <div className="gd-actions">
                  {sel.kind === "dir" && index.parent.get(sel.path) && (
                    <button type="button" className="btn sm" onClick={() => click({ id: sel.path, parent: null, label: sel.name, kind: "dir" })} disabled={!sel.count || sel.locked}>
                      {sel.children?.length && !sel.partial ? "Fold" : "Open in graph"}
                    </button>
                  )}
                  {sel.kind === "dir" && sel.path !== graph.root && (
                    <button type="button" className="btn sm" onClick={() => loadGraph(sel.path)}>
                      <FolderTree />
                      Center here
                    </button>
                  )}
                  {sel.kind !== "more" && (
                    <button type="button" className="btn sm" onClick={() => api.reveal(sel.path)}>
                      Show in Explorer
                      <ArrowUpRight />
                    </button>
                  )}
                  {entry && (
                    <button type="button" className="btn sm primary" onClick={() => store.set({ page: "scan", scanView: "results", focus: { id: entry.id } })}>
                      Review finding
                    </button>
                  )}
                </div>
              </>
            ) : (
              <div className="gd-empty">
                <FolderTree size={20} className="faint" />
                <p className="muted">Select a folder or file to see how it connects to {graph.root ? displayRoot(graph.root) : "the root"}.</p>
                <ul className="gd-tips faint">
                  <li>Click a folder to open or fold it</li>
                  <li>Double-click to show it in Explorer</li>
                  <li>Drag anything to rearrange the web</li>
                </ul>
              </div>
            )}
          </section>
          {graph.root && (
            <button type="button" className="btn ghost sm" onClick={() => loadGraph(graph.root!)} style={{ alignSelf: "flex-start" }}>
              <RefreshCw />
              Reload {shortPath(graph.root) === graph.root ? graph.root : baseName(graph.root)}
            </button>
          )}
        </aside>
      </div>
    </div>
  );
}
