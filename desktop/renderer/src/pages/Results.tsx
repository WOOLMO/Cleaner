import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Archive, ArrowDown, ArrowUp, ChevronDown, Download, File, FileText, Folder, FolderOpen, Plus, Search, ShieldCheck, Sparkles, Trash2, X,
} from "lucide-react";
import { api } from "../api";
import { act, store, toast, useStore } from "../store";
import { Checkbox, Dialog, PageHead, Segmented } from "../components/ui";
import { baseName, daysOld, dirName, displayRoot, duration, formatCount, formatSize, sentence, shortPath, timeAgo } from "../format";
import type { Entry } from "../types";

type Filter = "all" | "remove" | "review" | "done";
type SortKey = "size" | "name" | "age";
const sum = (list: Entry[]) => list.reduce((s, e) => s + e.size, 0);

function VerdictBadge({ e }: { e: Entry }) {
  if (e.status === "removed") return <span className="badge">Removed</span>;
  if (e.status === "held") return <span className="badge blue">On hold</span>;
  if (e.status === "failed") return <span className="badge red">Failed</span>;
  if (e.status === "missing") return <span className="badge">Gone</span>;
  return e.verdict === "remove" ? <span className="badge green">Safe</span> : <span className="badge amber">Your call</span>;
}

function ExportMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);
  const run = async (fn: () => Promise<unknown>) => {
    setOpen(false);
    await fn();
  };
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button type="button" className="btn" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Download />
        Export
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="card" style={{ position: "absolute", right: 0, top: 38, zIndex: 25, width: 250, padding: 6, boxShadow: "var(--shadow-2)" }} role="menu">
          {[
            { label: "Removal script (.ps1 + .bat)", hint: "Desktop", icon: <FileText size={15} />, fn: () => api.exportScript().then((f) => toast("ok", "Removal script saved to your Desktop", `${f.safe} safe items switched on, ${f.yours} your-call items switched off.`)) },
            { label: "HTML report", hint: ".html", icon: <FileText size={15} />, fn: () => api.exportReport("html") },
            { label: "Spreadsheet", hint: ".csv", icon: <FileText size={15} />, fn: () => api.exportReport("csv") },
            { label: "Data", hint: ".json", icon: <FileText size={15} />, fn: () => api.exportReport("json") },
          ].map((m) => (
            <button key={m.label} type="button" role="menuitem" className="btn ghost" style={{ width: "100%", justifyContent: "flex-start" }} onClick={() => run(m.fn)}>
              {m.icon}
              {m.label}
              <span className="faint" style={{ marginLeft: "auto", fontSize: 12 }}>{m.hint}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Results() {
  const scan = useStore((s) => s.scan)!;
  const settings = useStore((s) => s.settings);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "size", desc: true });
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [activeId, setActiveId] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<Entry[] | null>(null);
  const [busy, setBusy] = useState<{ action: "hold" | "delete"; done: number; total: number } | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const allowDelete = settings?.allowPermanentDelete ?? true;

  const entries = scan.entries;
  const pending = entries.filter((e) => e.status === "pending");
  const safe = pending.filter((e) => e.verdict === "remove");
  const yours = pending.filter((e) => e.verdict === "review");
  const done = entries.filter((e) => e.status !== "pending");
  const categories = useMemo(() => [...new Set(entries.map((e) => e.category))].sort(), [entries]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = entries.filter((e) => {
      if (filter === "remove" && !(e.status === "pending" && e.verdict === "remove")) return false;
      if (filter === "review" && !(e.status === "pending" && e.verdict === "review")) return false;
      if (filter === "done" && e.status === "pending") return false;
      if (filter === "all" && e.status !== "pending") return false;
      if (category && e.category !== category) return false;
      return !q || e.path.toLowerCase().includes(q) || e.reason.toLowerCase().includes(q) || e.category.includes(q);
    });
    const dir = sort.desc ? -1 : 1;
    list = [...list].sort((a, b) => {
      if (sort.key === "size") return (a.size - b.size) * dir;
      if (sort.key === "age") return ((a.mtime ?? 0) - (b.mtime ?? 0)) * -dir;
      return baseName(a.path).localeCompare(baseName(b.path)) * dir;
    });
    return list;
  }, [entries, filter, query, category, sort]);

  const virtual = useVirtualizer({ count: rows.length, getScrollElement: () => bodyRef.current, estimateSize: () => 52, overscan: 14 });

  const selectedEntries = entries.filter((e) => selected.has(e.id) && e.status === "pending");
  const selectable = rows.filter((e) => e.status === "pending");
  const allState: boolean | "mixed" = selectable.length && selectable.every((e) => selected.has(e.id)) ? true : selectable.some((e) => selected.has(e.id)) ? "mixed" : false;
  const active = activeId !== null ? entries.find((e) => e.id === activeId) ?? null : null;

  const focus = useStore((s) => s.focus);
  useEffect(() => {
    if (!focus) return;
    const entry = entries.find((e) => e.id === focus.id);
    if (entry) {
      setActiveId(entry.id);
      setSelected(new Set([entry.id]));
      if (focus.confirm) setConfirm([entry]);
    }
    store.set({ focus: null });
  }, [focus]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !confirm) {
        if (activeId !== null) setActiveId(null);
        else setSelected(new Set());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeId, confirm]);

  const toggle = (id: number) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const toggleAll = () => setSelected(allState === true ? new Set() : new Set(selectable.map((e) => e.id)));

  const run = async (list: Entry[], action: "hold" | "delete") => {
    setConfirm(null);
    setBusy({ action, done: 0, total: list.length });
    const off = api.onActProgress((p) => setBusy((b) => (b ? { ...b, ...p } : b)));
    await act(list.map((e) => e.id), action);
    off();
    setBusy(null);
    setSelected(new Set());
  };

  const sortButton = (key: SortKey, label: string, right = false) => (
    <button type="button" className={right ? "r" : ""} aria-sort={sort.key === key ? (sort.desc ? "descending" : "ascending") : undefined} onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : key !== "name" }))}>
      {label}
      {sort.key === key && (sort.desc ? <ArrowDown size={12} /> : <ArrowUp size={12} />)}
    </button>
  );

  return (
    <div className="page">
      <PageHead
        title="Findings"
        sub={
          <>
            {scan.roots.map(displayRoot).join(", ")} · {formatCount(scan.stats.files)} files · {duration(scan.durationMs)} · {timeAgo(scan.finishedAt)} ·{" "}
            <span title="How these findings were classified">{scan.classifiedBy}</span>
          </>
        }
        actions={
          <>
            <ExportMenu />
            <button type="button" className="btn primary" onClick={() => store.set({ scanView: "setup" })}>
              <Plus />
              New scan
            </button>
          </>
        }
      />

      {scan.aiError && (
        <div className="card" style={{ padding: "10px 14px", marginBottom: 14, borderColor: "var(--amber-line)", color: "var(--amber)" }}>
          Gemini stopped early ({scan.aiError}). Items it did not check use local rules only.
        </div>
      )}

      <div className="tiles results-tiles">
        <button type="button" className="tile" aria-pressed={filter === "remove"} onClick={() => setFilter(filter === "remove" ? "all" : "remove")}>
          <span className="k">
            <i style={{ background: "var(--accent)" }} />
            Safe to remove
          </span>
          <span className="v" style={{ color: "var(--accent)" }}>{formatSize(sum(safe))}</span>
          <span className="d">{formatCount(safe.length)} items, rules and Gemini agree</span>
        </button>
        <button type="button" className="tile" aria-pressed={filter === "review"} onClick={() => setFilter(filter === "review" ? "all" : "review")}>
          <span className="k">
            <i style={{ background: "var(--amber)" }} />
            Your call
          </span>
          <span className="v" style={{ color: "var(--amber)" }}>{formatSize(sum(yours))}</span>
          <span className="d">{formatCount(yours.length)} items worth a look</span>
        </button>
        <button type="button" className="tile" aria-pressed={filter === "done"} onClick={() => setFilter(filter === "done" ? "all" : "done")}>
          <span className="k">
            <i style={{ background: "var(--text-3)" }} />
            Handled
          </span>
          <span className="v">{formatSize(sum(done))}</span>
          <span className="d">{formatCount(done.length)} items removed or on hold</span>
        </button>
        <div className="tile">
          <span className="k">
            <ShieldCheck size={13} />
            Left alone
          </span>
          <span className="v">{formatCount(scan.leftOut)}</span>
          <span className="d">candidates that looked important</span>
        </div>
      </div>

      <div className="toolbar">
        <Segmented<Filter>
          label="Show"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "To review", count: pending.length },
            { value: "remove", label: "Safe", count: safe.length },
            { value: "review", label: "Your call", count: yours.length },
            { value: "done", label: "Handled", count: done.length },
          ]}
        />
        <div className="input-icon">
          <Search />
          <input className="input" placeholder="Search path or reason" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search findings" />
        </div>
        <select className="input" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {sentence(c)}
            </option>
          ))}
        </select>
        <span className="spacer" />
        <span className="faint num">
          {formatCount(rows.length)} shown · {formatSize(sum(rows))}
        </span>
      </div>

      <div className="table" role="grid" aria-rowcount={rows.length}>
        <div className="thead" role="row">
          <Checkbox state={allState} onChange={toggleAll} label="Select all shown" disabled={!selectable.length} />
          {sortButton("name", "Item")}
          <span>Category</span>
          {sortButton("age", "Age")}
          {sortButton("size", "Size", true)}
          <span>Verdict</span>
        </div>
        <div className="tbody" ref={bodyRef}>
          {rows.length === 0 && <div className="empty">Nothing matches. Try another filter.</div>}
          <div style={{ height: virtual.getTotalSize(), position: "relative" }}>
            {virtual.getVirtualItems().map((v) => {
              const e = rows[v.index];
              const isPending = e.status === "pending";
              return (
                <div
                  key={e.id}
                  role="row"
                  className={`trow${activeId === e.id ? " active" : ""}${isPending ? "" : " done"}`}
                  aria-selected={selected.has(e.id)}
                  style={{ transform: `translateY(${v.start}px)` }}
                  onClick={() => setActiveId(e.id)}
                >
                  <Checkbox state={selected.has(e.id)} onChange={() => toggle(e.id)} label={`Select ${baseName(e.path)}`} disabled={!isPending} />
                  <div className="name">
                    <b>
                      {e.kind === "dir" ? <Folder /> : <File />}
                      <span className="truncate">{baseName(e.path)}</span>
                    </b>
                    <span className="where truncate">{shortPath(dirName(e.path))}</span>
                  </div>
                  <span className="truncate muted">{sentence(e.category)}</span>
                  <span className="muted num">{daysOld(e.mtime)}</span>
                  <span className="size-cell r">{formatSize(e.size)}</span>
                  <span>
                    <VerdictBadge e={e} />
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {active && (
        <aside className="drawer" aria-label="Item details">
          <header>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h3>{baseName(active.path)}</h3>
              <VerdictBadge e={active} />
            </div>
            <button type="button" className="btn ghost icon" aria-label="Close details" onClick={() => setActiveId(null)}>
              <X />
            </button>
          </header>
          <div className="body">
            <div className="why">
              <div className="who">
                <Sparkles />
                {scan.classifiedBy.includes("+") ? "Why, from local rules and Gemini" : "Why, from local rules"}
              </div>
              <p>{active.reason}</p>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
                <span className="faint" style={{ fontSize: 12 }}>Confidence</span>
                <div className="meter thin" style={{ flex: 1 }}>
                  <i style={{ width: `${Math.round(active.confidence * 100)}%`, background: active.verdict === "remove" ? "var(--accent)" : "var(--amber)" }} />
                </div>
                <span className="mono faint" style={{ fontSize: 12 }}>{Math.round(active.confidence * 100)}%</span>
              </div>
            </div>
            <dl className="facts">
              <dt>Size</dt>
              <dd className="mono">{formatSize(active.size)}</dd>
              <dt>Category</dt>
              <dd>{sentence(active.category)}</dd>
              {active.kind === "dir" && active.files !== undefined && (
                <>
                  <dt>Contains</dt>
                  <dd>{formatCount(active.files)} files</dd>
                </>
              )}
              {active.mtime && (
                <>
                  <dt>Last changed</dt>
                  <dd>{new Date(active.mtime).toLocaleDateString()} ({daysOld(active.mtime)} ago)</dd>
                </>
              )}
              {active.fileType && (
                <>
                  <dt>Real type</dt>
                  <dd>{active.fileType}</dd>
                </>
              )}
              {active.sensitive && (
                <>
                  <dt>Note</dt>
                  <dd style={{ color: "var(--amber)" }}>Looks like it holds credentials, never auto-removed</dd>
                </>
              )}
            </dl>
            <div>
              <div className="faint" style={{ fontSize: 12, marginBottom: 6 }}>Location</div>
              <div className="pathbox">{active.path}</div>
            </div>
            {active.duplicateOf && (
              <div>
                <div className="faint" style={{ fontSize: 12, marginBottom: 6 }}>Identical copy kept at</div>
                <div className="pathbox">{active.duplicateOf}</div>
              </div>
            )}
          </div>
          <footer>
            <button type="button" className="btn" onClick={() => api.reveal(active.path)}>
              <FolderOpen />
              Show in Explorer
            </button>
            {active.status === "pending" && (
              <>
                <button type="button" className="btn" style={{ marginLeft: "auto" }} onClick={() => run([active], "hold")}>
                  <Archive />
                  Hold
                </button>
                {allowDelete && (
                  <button type="button" className="btn danger" onClick={() => setConfirm([active])}>
                    <Trash2 />
                    Delete
                  </button>
                )}
              </>
            )}
          </footer>
        </aside>
      )}

      {(selectedEntries.length > 0 || busy) && (
        <div className={`actionbar${active ? " beside-drawer" : ""}`} role="toolbar" aria-label="Selection">
          {busy ? (
            <span className="sel">
              {busy.action === "hold" ? "Moving to holding" : "Deleting"} <b>{busy.done}</b> of {busy.total}…
            </span>
          ) : (
            <>
              <span className="sel">
                <b>{selectedEntries.length}</b> selected · <b className="mono">{formatSize(sum(selectedEntries))}</b>
              </span>
              <button type="button" className="btn sm ghost" onClick={() => setSelected(new Set())}>
                Clear
              </button>
              <span className="sep" />
              <button type="button" className="btn" onClick={() => run(selectedEntries, "hold")} title="Undoable: restore any time from the holding area">
                <Archive />
                Move to holding
              </button>
              {allowDelete ? (
                <button type="button" className="btn danger solid" onClick={() => setConfirm(selectedEntries)}>
                  <Trash2 />
                  Delete permanently
                </button>
              ) : (
                <span className="faint" style={{ fontSize: 12, padding: "0 8px" }}>Deletion is set to holding by your organization</span>
              )}
            </>
          )}
        </div>
      )}

      <Dialog
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        tone="danger"
        icon={<Trash2 size={18} />}
        title={`Delete ${confirm?.length ?? 0} item${confirm?.length === 1 ? "" : "s"} permanently?`}
        body={
          <>
            This frees <b className="mono">{formatSize(sum(confirm ?? []))}</b> right away and cannot be undone. If you might need them, move them to the holding area instead.
          </>
        }
        footer={
          <>
            <button type="button" className="btn" data-autofocus onClick={() => setConfirm(null)}>
              Cancel
            </button>
            <button type="button" className="btn" onClick={() => confirm && run(confirm, "hold")}>
              <Archive />
              Hold instead
            </button>
            <button type="button" className="btn danger solid" onClick={() => confirm && run(confirm, "delete")}>
              <Trash2 />
              Delete {confirm?.length ?? 0}
            </button>
          </>
        }
      >
        <ul className="path-list">
          {(confirm ?? []).slice(0, 8).map((e) => (
            <li key={e.id}>
              <span>{shortPath(e.path)}</span>
              <span>{formatSize(e.size)}</span>
            </li>
          ))}
          {(confirm?.length ?? 0) > 8 && <li className="faint">…and {(confirm?.length ?? 0) - 8} more</li>}
        </ul>
      </Dialog>
    </div>
  );
}
