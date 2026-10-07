import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, FolderOpen, FolderTree, HardDrive, Home, Network, Search, X } from "lucide-react";
import { api } from "../api";
import { buildNetwork, cancelNetwork, loadGraph, setGraphMode, useStore } from "../store";
import { ForceGraph, type GNode } from "../components/ForceGraph";
import { branchColor, networkNodes } from "../components/networkLayout";
import { PageHead } from "../components/ui";
import { displayRoot, duration, formatCount, formatSize, shortPath } from "../format";

// Every folder of a drive or user folder at once, as one network.
export function FullNetwork() {
  const info = useStore((s) => s.info);
  const drives = useStore((s) => s.drives);
  const graph = useStore((s) => s.graph);
  const [selected, setSelected] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const net = graph.network;
  const building = graph.building;
  const dark = document.documentElement.dataset.theme !== "light";

  useEffect(() => {
    if (!net && !building && info) buildNetwork(graph.root ?? info.home);
  }, []);
  useEffect(() => {
    setSelected(null);
    setQuery("");
  }, [net]);

  const branches = useMemo(() => {
    if (!net) return [];
    return net.nodes
      .filter((n) => n.parent === 0)
      .sort((a, b) => b.size - a.size)
      .map((n, i) => ({ n, i }));
  }, [net]);
  // the layout colors top-level folders in size order, the same order as this legend
  const sel = net && selected !== null ? net.nodes[selected] : null;
  const crumbs = useMemo(() => {
    if (!net || selected === null) return [];
    const out = [];
    for (let id = selected; id >= 0; id = net.nodes[id].parent) out.unshift(net.nodes[id]);
    return out;
  }, [net, selected]);
  const total = net?.nodes[0]?.size || 1;
  const gnodes = useMemo(() => (net ? networkNodes(net, dark) : []), [net, dark]);
  const emphasis = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!net || q.length < 2) return null;
    return new Set(net.nodes.filter((n) => n.name.toLowerCase().includes(q)).map((n) => String(n.id)));
  }, [net, query]);
  const tooltip = (g: GNode) => {
    const n = net!.nodes[Number(g.id)];
    const pct = (n.size / total) * 100;
    return { title: n.name, sub: `${formatSize(n.size)} · ${pct.toFixed(pct < 1 ? 2 : 1)}% of everything${n.more ? "" : n.sub ? ` · ${n.sub} subfolders` : ""}` };
  };
  const matches = net && query.trim().length >= 2 ? net.nodes.filter((n) => n.name.toLowerCase().includes(query.trim().toLowerCase())).length : 0;

  const rebuild = (root: string) => buildNetwork(root);
  const pick = async () => {
    const dir = await api.pickFolder("Choose a folder to map");
    if (dir) rebuild(dir);
  };

  return (
    <div className="page page-wide">
      <PageHead
        title="Full network"
        sub="Every folder at once as one living web, each top-level branch in its own color. Hover to trace a path, drag to rearrange, scroll to zoom."
        actions={
          <>
            <button type="button" className="btn" onClick={() => setGraphMode("graph")}>
              <FolderTree />
              Folder graph
            </button>
            {info && (
              <button type="button" className="btn" aria-pressed={net?.root === info.home} onClick={() => rebuild(info.home)} disabled={Boolean(building)}>
                <Home />
                User folder
              </button>
            )}
            {drives.slice(0, 2).map((d) => (
              <button key={d.root} type="button" className="btn" aria-pressed={net?.root === d.root} onClick={() => rebuild(d.root)} disabled={Boolean(building)}>
                <HardDrive />
                {d.letter}:
              </button>
            ))}
            <button type="button" className="btn" onClick={pick} disabled={Boolean(building)}>
              <FolderOpen />
              Choose folder
            </button>
          </>
        }
      />
      <div className="graph-layout">
        <section className="card graph-card">
          {net && !building ? (
            <>
              <ForceGraph
                nodes={gnodes}
                selected={selected === null ? null : String(selected)}
                emphasis={emphasis}
                onNodeClick={(g) => setSelected(Number(g.id))}
                onNodeOpen={(g) => g.kind !== "more" && api.reveal(net.nodes[Number(g.id)].path)}
                tooltip={tooltip}
                fitKey={net.root}
              />
              <div className="fg-search input-icon">
                <Search />
                <input className="input" placeholder="Find a folder" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setQuery("")} />
                {query && (
                  <button type="button" className="btn ghost icon sm fg-clear" title="Clear" onClick={() => setQuery("")}>
                    <X />
                  </button>
                )}
              </div>
              {query.trim().length >= 2 && <div className="fg-busy">{matches ? `${formatCount(matches)} folder${matches === 1 ? "" : "s"} match` : "No folder matches"}</div>}
            </>
          ) : (
            <div className="nv-building">
              <div className="nv-orbit" aria-hidden="true">
                <i />
                <i />
                <i />
                <Network size={26} />
              </div>
              <h3>Mapping every folder{building ? ` in ${displayRoot(building.root)}` : ""}</h3>
              <p className="muted num">
                {building ? `${formatCount(building.files)} files · ${formatSize(building.bytes)} · ${duration(Date.now() - building.startedAt)}` : "Starting"}
              </p>
              <p className="mono faint truncate nv-current">{building?.current ? shortPath(building.current) : " "}</p>
              <p className="faint" style={{ maxWidth: 420, textAlign: "center" }}>
                A whole drive takes a minute or two. If you mapped this place on the Space map, it opens instantly.
              </p>
              {building && (
                <button type="button" className="btn sm" onClick={() => cancelNetwork()}>
                  Cancel
                </button>
              )}
            </div>
          )}
        </section>

        <aside className="graph-side">
          <section className="card">
            <div className="card-body graph-stats">
              <div>
                <span className="k">Folders</span>
                <b className="num">{net ? formatCount(net.total.dirs) : "…"}</b>
                <span className="faint">{net ? `${formatCount(net.shown)} drawn, the biggest first` : " "}</span>
              </div>
              <div>
                <span className="k">Size</span>
                <b className="num">{net ? formatSize(net.total.bytes || total) : "…"}</b>
                <span className="faint truncate">{net ? `${formatCount(net.total.files)} files in ${displayRoot(net.root)}` : " "}</span>
              </div>
            </div>
          </section>

          {sel ? (
            <section className="card graph-detail">
              <div className="gd-head">
                <span className="gd-icon" style={{ color: crumbs[1] ? branchColor(branches.findIndex((b) => b.n.id === crumbs[1].id), dark) : undefined }}>
                  <FolderOpen size={18} />
                </span>
                <div className="truncate">
                  <h3 className="truncate" title={sel.name}>{sel.name}</h3>
                  <span className="muted">
                    {formatSize(sel.size)} · {((sel.size / total) * 100).toFixed(sel.size / total < 0.01 ? 2 : 1)}% of everything
                  </span>
                </div>
              </div>
              <div className="nv-share">
                <i style={{ width: `${Math.max(0.5, (sel.size / total) * 100)}%` }} />
              </div>
              <div className="gd-label">Connection</div>
              <ol className="crumbs">
                {crumbs.map((c, i) => (
                  <li key={c.id}>
                    {i > 0 && <span className="faint">›</span>}
                    <button type="button" className={c.id === selected ? "on" : ""} onClick={() => setSelected(c.id)}>
                      {i === 0 ? displayRoot(c.path) : c.name}
                    </button>
                  </li>
                ))}
              </ol>
              {!sel.more && <div className="gd-path mono selectable">{sel.path}</div>}
              <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>
                {sel.more ? `${sel.more} smaller folders folded into one node to keep the network readable.` : sel.sub ? `${sel.sub} subfolders${sel.open ? "" : ", not drawn"}.` : "No subfolders."}
              </p>
              {!sel.more && (
                <div className="gd-actions">
                  <button
                    type="button"
                    className="btn sm"
                    onClick={() => {
                      setGraphMode("graph");
                      loadGraph(sel.path);
                    }}
                  >
                    <FolderTree />
                    Open in folder graph
                  </button>
                  <button type="button" className="btn sm" onClick={() => api.reveal(sel.path)}>
                    Show in Explorer
                    <ArrowUpRight />
                  </button>
                </div>
              )}
            </section>
          ) : (
            <section className="card nv-legend">
              <div className="card-head">
                <h2>Branches</h2>
                <span className="sub">by size</span>
              </div>
              <ul>
                {branches.slice(0, 14).map(({ n, i }) => (
                  <li key={n.id}>
                    <button type="button" onClick={() => setSelected(n.id)}>
                      <i style={{ background: branchColor(i, dark) }} />
                      <span className="truncate">{n.name}</span>
                      <span className="mono faint">{formatSize(n.size)}</span>
                    </button>
                  </li>
                ))}
                {!branches.length && <li className="muted" style={{ padding: "8px 10px" }}>Branches appear when the map is ready.</li>}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
