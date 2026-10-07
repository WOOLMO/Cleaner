import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight, Check, CircleSlash, Download, FileText, Folder, FolderOpen, FolderPlus, Image, LayoutGrid, LoaderCircle, Monitor, Network,
  Pencil, Sparkles, Undo2, Wand2,
} from "lucide-react";
import { api } from "../api";
import { applyOrganize, cancelOrganize, loadOrganize, planOrganize, undoOrganize, useStore } from "../store";
import { ForceGraph, kindColor, type GNode } from "../components/ForceGraph";
import { Checkbox, PageHead, Segmented } from "../components/ui";
import { baseName, displayRoot, formatCount, formatSize, shortPath, timeAgo } from "../format";
import type { Casing, OrganizeFile, OrganizeMove, OrganizePlan } from "../types";

const PLACE_ICONS: Record<string, React.ReactNode> = {
  desktop: <Monitor size={18} />,
  downloads: <Download size={18} />,
  documents: <FileText size={18} />,
  pictures: <Image size={18} />,
};

export const CASING: Record<Casing, string> = {
  title: "Title Case", lower: "lower case", upper: "UPPER CASE", kebab: "kebab-case", snake: "snake_case", pascal: "PascalCase", sentence: "Sentence case", natural: "As written",
};

const theme = () => (document.documentElement.dataset.theme === "light" ? "light" : "dark");
const plural = (n: number, word: string) => `${formatCount(n)} ${word}${n === 1 ? "" : "s"}`;

interface Group {
  folder: string;
  isNew: boolean;
  moves: (OrganizeMove & { file: OrganizeFile })[];
}

export function Organize() {
  const org = useStore((s) => s.org);
  const settings = useStore((s) => s.settings);
  const aiOn = Boolean(settings?.settings.aiEnabled && settings.key.hasKey);

  useEffect(() => {
    loadOrganize();
  }, []);

  const choose = async () => {
    const dir = await api.pickFolder("Choose a folder to organize");
    if (dir) planOrganize(dir);
  };

  return (
    <div className="page">
      <PageHead
        title="Organize"
        sub="Tidy loose files into folders, named the way you already name things. Nothing is deleted, and every run can be undone."
        actions={
          <button type="button" className="btn" onClick={choose}>
            <FolderOpen />
            Choose folder
          </button>
        }
      />

      <div className="org-places">
        {org.places.map((p) => (
          <button key={p.path} type="button" className="tile org-place" aria-pressed={org.root === p.path} onClick={() => planOrganize(p.path)} disabled={org.planning || org.applying}>
            <span className="op-icon">{PLACE_ICONS[p.id] ?? <Folder size={18} />}</span>
            <span className="op-text">
              <b>{p.name}</b>
              <span className={p.loose ? "" : "faint"}>{p.loose ? plural(p.loose, "loose file") : "Already tidy"}</span>
            </span>
            {org.planning && org.root === p.path ? <LoaderCircle className="spin op-go" size={16} /> : <ArrowRight className="op-go" size={16} />}
          </button>
        ))}
        <button type="button" className="tile org-place dashed" onClick={choose} disabled={org.planning || org.applying}>
          <span className="op-icon">
            <FolderOpen size={18} />
          </span>
          <span className="op-text">
            <b>Another folder</b>
            <span className="faint">Any folder you own</span>
          </span>
        </button>
      </div>

      {org.planning && <Planning root={org.root} ai={aiOn} />}
      {!org.planning && org.plan && <PlanView key={org.plan.root + org.plan.files.length} plan={org.plan} applying={org.applying} />}
      {!org.planning && !org.plan && org.run && <Done />}
      {!org.planning && !org.plan && !org.run && <Intro ai={aiOn} />}

      {!org.plan && org.history.length > 0 && (
        <section className="card" style={{ marginTop: 18 }}>
          <div className="card-head">
            <h2>Past runs</h2>
            <span className="sub">Each run can be put back as long as the files stayed where it left them.</span>
          </div>
          <ul className="list org-history">
            {org.history.map((r) => (
              <li key={r.id}>
                <span className="oh-icon">{r.undoneAt ? <Undo2 size={15} /> : <Wand2 size={15} />}</span>
                <div className="truncate">
                  <div className="t truncate">
                    {plural(r.moved, "file")} into {plural(r.folders.length, "folder")} in {displayRoot(r.root)}
                  </div>
                  <div className="s truncate">
                    {timeAgo(r.time)} · {r.folders.slice(0, 5).join(", ")}
                    {r.folders.length > 5 ? ", …" : ""}
                  </div>
                </div>
                {r.undoneAt ? (
                  <span className="badge">Undone {timeAgo(r.undoneAt)}</span>
                ) : (
                  <button type="button" className="btn sm" onClick={() => undoOrganize(r.id)}>
                    <Undo2 />
                    Undo
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Intro({ ai }: { ai: boolean }) {
  const steps = [
    { icon: <LayoutGrid size={18} />, title: "Reads your style", body: "Looks at the folders you already made: their language, their casing, what each one holds." },
    { icon: <Sparkles size={18} />, title: ai ? "Plans with Gemini" : "Plans with local rules", body: ai ? "Gemini groups files by purpose from their names. Only names, sizes and dates are sent." : "Files go to your matching folders first, then to new ones named your way." },
    { icon: <Check size={18} />, title: "You approve", body: "Preview every move, untick or rename anything, then apply. Undo puts it all back." },
  ];
  return (
    <section className="card org-intro">
      {steps.map((s, i) => (
        <div key={s.title} className="oi-step" style={{ animationDelay: `${i * 70}ms` }}>
          <span className="oi-icon">{s.icon}</span>
          <b>{s.title}</b>
          <p className="muted">{s.body}</p>
        </div>
      ))}
    </section>
  );
}

function Planning({ root, ai }: { root: string | null; ai: boolean }) {
  return (
    <section className="card org-planning">
      <div className="opl-orbit">
        <i />
        <i />
        <i />
        <FolderPlus size={22} />
      </div>
      <div>
        <h3>Planning {root ? displayRoot(root) : "the folder"}</h3>
        <p className="muted">{ai ? "Reading your folder names, then Gemini groups the loose files." : "Reading your folder names and matching every loose file."}</p>
      </div>
    </section>
  );
}

function Done() {
  const run = useStore((s) => s.org.run)!;
  return (
    <section className="card org-done">
      <div className="od-check">
        <Check size={26} />
      </div>
      <div className="od-text">
        <h3>{displayRoot(run.root) === "your user folder" ? "Your user folder" : baseName(run.root)} is organized</h3>
        <p className="muted">
          {plural(run.moved, "file")} moved into {plural(run.folders.length, "folder")}
          {run.createdFolders ? `, ${run.createdFolders} of them new` : ""}. {formatSize(run.bytes)} in all.
          {run.failed.length ? ` ${run.failed.length} were in use and stayed put.` : ""}
        </p>
        <div className="od-chips">
          {run.folders.map((f) => (
            <span key={f} className="pill static">
              <Folder size={13} />
              {f}
            </span>
          ))}
        </div>
      </div>
      <div className="od-actions">
        <button type="button" className="btn" onClick={() => api.reveal(run.root)}>
          <FolderOpen />
          Show in Explorer
        </button>
        <button type="button" className="btn" onClick={() => undoOrganize(run.id)}>
          <Undo2 />
          Undo
        </button>
      </div>
    </section>
  );
}

function PlanView({ plan, applying }: { plan: OrganizePlan; applying: boolean }) {
  const [view, setView] = useState<"folders" | "graph">("folders");
  const [off, setOff] = useState<Set<number>>(new Set());
  const [names, setNames] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());

  const files = useMemo(() => new Map(plan.files.map((f) => [f.id, f])), [plan]);
  const groups = useMemo(() => {
    const map = new Map<string, Group>();
    for (const m of plan.moves) {
      const file = files.get(m.id);
      if (!file) continue;
      if (!map.has(m.folder)) map.set(m.folder, { folder: m.folder, isNew: m.isNew, moves: [] });
      map.get(m.folder)!.moves.push({ ...m, file });
    }
    return [...map.values()].sort((a, b) => Number(a.isNew) - Number(b.isNew) || b.moves.length - a.moves.length);
  }, [plan, files]);

  const chosen = plan.moves.filter((m) => !off.has(m.id));
  const nameOf = (folder: string) => names[folder]?.trim() || folder;
  const targetFolders = new Set(chosen.map((m) => nameOf(m.folder)));
  const newCount = groups.filter((g) => g.isNew && g.moves.some((m) => !off.has(m.id))).length;
  const fromGemini = plan.moves.filter((m) => m.source === "gemini").length;
  const { style } = plan;

  const toggle = (ids: number[], on: boolean) =>
    setOff((prev) => {
      const next = new Set(prev);
      for (const id of ids) (on ? next.delete(id) : next.add(id));
      return next;
    });

  const graphNodes = useMemo<GNode[]>(() => {
    const rootId = plan.root;
    const out: GNode[] = [{ id: rootId, parent: null, label: baseName(plan.root), kind: "root" }];
    for (const g of groups) {
      const live = g.moves.filter((m) => !off.has(m.id));
      if (!live.length) continue;
      out.push({ id: `folder:${g.folder}`, parent: rootId, label: nameOf(g.folder), kind: "dir", count: live.length, tone: g.isNew ? "new" : undefined, open: true });
      for (const m of live) out.push({ id: `file:${m.id}`, parent: `folder:${g.folder}`, label: m.file.name, kind: "file", size: m.file.size, category: m.file.category ?? "other" });
    }
    for (const g of groups) for (const m of g.moves) if (off.has(m.id)) out.push({ id: `file:${m.id}`, parent: rootId, label: m.file.name, kind: "file", size: m.file.size, category: m.file.category ?? "other" });
    for (const s of plan.stay) {
      const f = files.get(s.id);
      if (f) out.push({ id: `file:${f.id}`, parent: rootId, label: f.name, kind: "file", size: f.size, category: f.category ?? "other" });
    }
    return out;
  }, [plan, groups, off, names]);

  return (
    <>
      <div className="org-top">
        <section className="card org-summary">
          <div className="os-flow">
            <div>
              <span className="k">Loose files</span>
              <b className="num">{formatCount(plan.files.length)}</b>
            </div>
            <ArrowRight className="os-arrow" />
            <div>
              <span className="k">Folders</span>
              <b className="num">{formatCount(targetFolders.size)}</b>
            </div>
          </div>
          <div className="os-meta">
            <span className="badge green">{newCount} new</span>
            <span className="badge">{targetFolders.size - newCount} of yours</span>
            {plan.stay.length + plan.skipped.length > 0 && <span className="badge">{plan.stay.length + plan.skipped.length} left alone</span>}
          </div>
          <div className="os-by faint">
            {fromGemini ? <Sparkles size={13} /> : <Wand2 size={13} />}
            {fromGemini ? `Planned with ${plan.planner}, ${fromGemini} of ${plan.moves.length} placed by Gemini` : "Planned with local rules"}
          </div>
        </section>

        <section className="card org-style">
          <span className="k">Your style</span>
          <div className="ost-main">
            <b>{style.languageName}</b>
            <span className="badge">{CASING[style.casing] ?? style.casing}</span>
            {style.numbering && <span className="badge">Numbered</span>}
          </div>
          <p className="muted">
            {style.detected
              ? `Read from ${plural(plan.folders.length, "folder")} you already made. New folders follow the same language and casing.`
              : `No style to follow yet, so new folders get plain names in ${style.languageName}${style.languageSource === "system" ? ", your Windows language" : ""}.`}
          </p>
          {style.sampleNames.length > 0 && (
            <div className="ost-chips">
              {style.sampleNames.slice(0, 7).map((n) => (
                <span key={n} className="pill static">
                  <Folder size={12} />
                  {n}
                </span>
              ))}
            </div>
          )}
        </section>
      </div>

      <div className="org-toolbar">
        <h2>The plan</h2>
        <span className="muted">{shortPath(plan.root)}</span>
        <div className="right">
          <Segmented
            label="View"
            value={view}
            onChange={setView}
            options={[
              { value: "folders", label: "Folders", icon: <LayoutGrid size={14} /> },
              { value: "graph", label: "Graph", icon: <Network size={14} /> },
            ]}
          />
        </div>
      </div>

      {view === "graph" ? (
        <section className="card org-graph">
          <ForceGraph
            nodes={graphNodes}
            tooltip={(n) =>
              n.kind === "file"
                ? { title: n.label, sub: `${formatSize(n.size ?? 0)} · ${n.parent === plan.root ? "stays where it is" : `goes to ${n.parent?.replace("folder:", "")}`}` }
                : n.kind === "dir"
                  ? { title: n.label, sub: `${plural(n.count ?? 0, "file")}${n.tone === "new" ? " · new folder" : " · your folder"}` }
                  : { title: n.label, sub: "The folder being organized" }
            }
            onNodeClick={(n) => n.kind === "file" && toggle([Number(n.id.slice(5))], off.has(Number(n.id.slice(5))))}
          >
            <div className="fg-legend">
              <span className="pill static">
                <i className="ring" />
                Your folders
              </span>
              <span className="pill static">
                <i className="ring dashed" />
                New folders
              </span>
              <span className="pill static faint">Click a file to keep it where it is</span>
            </div>
          </ForceGraph>
        </section>
      ) : (
        <div className="org-grid">
          {groups.map((g, i) => {
            const live = g.moves.filter((m) => !off.has(m.id));
            const all = live.length === g.moves.length ? true : live.length ? "mixed" : false;
            const expanded = open.has(g.folder);
            const shown = expanded ? g.moves : g.moves.slice(0, 6);
            return (
              <section key={g.folder} className={`org-card ${g.isNew ? "new" : ""} ${live.length ? "" : "off"}`} style={{ animationDelay: `${Math.min(i, 12) * 35}ms` }}>
                <header>
                  <Checkbox state={all} onChange={() => toggle(g.moves.map((m) => m.id), all !== true)} label={`Move files into ${nameOf(g.folder)}`} />
                  <span className="oc-icon">{g.isNew ? <FolderPlus size={17} /> : <Folder size={17} />}</span>
                  {editing === g.folder ? (
                    <input
                      className="input oc-rename"
                      autoFocus
                      defaultValue={nameOf(g.folder)}
                      maxLength={60}
                      onBlur={(e) => {
                        setNames((n) => ({ ...n, [g.folder]: e.target.value }));
                        setEditing(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                        if (e.key === "Escape") setEditing(null);
                      }}
                    />
                  ) : (
                    <h3 className="truncate" title={nameOf(g.folder)}>
                      {nameOf(g.folder)}
                    </h3>
                  )}
                  {g.isNew && editing !== g.folder && (
                    <button type="button" className="btn ghost icon sm" title="Rename this new folder" onClick={() => setEditing(g.folder)}>
                      <Pencil />
                    </button>
                  )}
                  <span className={`badge ${g.isNew ? "green" : ""}`}>{g.isNew ? "New" : "Yours"}</span>
                </header>
                <div className="oc-meta">
                  {plural(live.length, "file")} · {formatSize(live.reduce((s, m) => s + m.file.size, 0))}
                </div>
                <ul>
                  {shown.map((m) => (
                    <li key={m.id} className={off.has(m.id) ? "off" : ""} title={m.reason}>
                      <Checkbox state={!off.has(m.id)} onChange={() => toggle([m.id], off.has(m.id))} label={`Move ${m.file.name}`} />
                      <i className="dot" style={{ background: kindColor(m.file.category ?? "other", theme()) }} />
                      <span className="truncate">{m.file.name}</span>
                      {m.source === "gemini" && <Sparkles size={12} className="oc-ai" />}
                      <span className="num faint">{formatSize(m.file.size)}</span>
                    </li>
                  ))}
                </ul>
                {g.moves.length > 6 && (
                  <button type="button" className="btn ghost sm oc-more" onClick={() => setOpen((s) => (s.has(g.folder) ? new Set([...s].filter((x) => x !== g.folder)) : new Set([...s, g.folder])))}>
                    {expanded ? "Show less" : `Show ${g.moves.length - 6} more`}
                  </button>
                )}
                <p className="oc-why faint">{g.moves[0].reason}</p>
              </section>
            );
          })}

          {plan.stay.length + plan.skipped.length > 0 && (
            <section className="org-card stay" style={{ animationDelay: `${Math.min(groups.length, 12) * 35}ms` }}>
              <header>
                <span className="oc-icon">
                  <CircleSlash size={17} />
                </span>
                <h3>Left where they are</h3>
              </header>
              <div className="oc-meta">{plural(plan.stay.length + plan.skipped.length, "file")}</div>
              <ul>
                {plan.stay.map((s) => {
                  const f = files.get(s.id);
                  return f ? (
                    <li key={`s${s.id}`} title={s.reason}>
                      <i className="dot" style={{ background: kindColor(f.category ?? "other", theme()) }} />
                      <span className="truncate">{f.name}</span>
                      <span className="faint oc-reason truncate">{s.reason}</span>
                    </li>
                  ) : null;
                })}
                {plan.skipped.map((s) => (
                  <li key={`k${s.name}`} title={s.reason}>
                    <i className="dot" style={{ background: "var(--text-3)" }} />
                    <span className="truncate">{s.name}</span>
                    <span className="faint oc-reason truncate">{s.reason}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      <div className="actionbar org-bar">
        <div className="ab-text">
          <b>
            Move {plural(chosen.length, "file")} into {plural(targetFolders.size, "folder")}
          </b>
          <span className="muted">Nothing is deleted. Undo puts every file back.</span>
        </div>
        <button type="button" className="btn ghost" onClick={cancelOrganize} disabled={applying}>
          Cancel
        </button>
        <button type="button" className="btn primary" disabled={!chosen.length || applying} onClick={() => applyOrganize(chosen.map((m) => ({ id: m.id, folder: nameOf(m.folder) })))}>
          {applying ? <LoaderCircle className="spin" /> : <Wand2 />}
          Organize
        </button>
      </div>
    </>
  );
}
