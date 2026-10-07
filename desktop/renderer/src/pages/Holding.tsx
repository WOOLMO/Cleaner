import { useEffect, useState } from "react";
import { Archive, ArchiveRestore, Info, Trash2 } from "lucide-react";
import { api } from "../api";
import { errorMessage, refreshActivity, refreshDrives, refreshHeld, store, toast, useStore } from "../store";
import { Checkbox, Dialog, Empty, PageHead } from "../components/ui";
import { baseName, dirName, formatSize, shortPath } from "../format";
import type { Held } from "../types";

const sum = (list: Held[]) => list.reduce((s, h) => s + h.size, 0);

export function Holding() {
  const held = useStore((s) => s.held);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<Held[] | null>(null);

  useEffect(() => {
    refreshHeld();
  }, []);

  const toggle = (p: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(p)) n.delete(p);
      else n.add(p);
      return n;
    });
  const chosen = held.filter((h) => selected.has(h.held));
  const allState: boolean | "mixed" = held.length && chosen.length === held.length ? true : chosen.length ? "mixed" : false;

  const after = () => {
    setSelected(new Set());
    refreshHeld();
    refreshDrives();
    refreshActivity();
    api.lastScan().then((scan) => store.set({ scan }));
  };

  const restore = async (list: Held[]) => {
    try {
      const r = await api.restoreHeld(list.map((h) => h.held));
      toast(r.conflicts || r.failed ? "warn" : "ok", `${r.restored} item${r.restored === 1 ? "" : "s"} restored`, r.conflicts ? `${r.conflicts} skipped because something new already sits at the original place.` : "Back where they were.");
    } catch (err) {
      toast("error", "Nothing was restored", errorMessage(err));
    }
    after();
  };

  const purge = async (list: Held[]) => {
    setConfirm(null);
    try {
      const r = await api.purgeHeld(list.map((h) => h.held));
      toast(r.failed ? "warn" : "ok", `${r.purged} held item${r.purged === 1 ? "" : "s"} deleted`, r.freed ? `${formatSize(r.freed)} freed on the drive.` : undefined);
    } catch (err) {
      toast("error", "Nothing was purged", errorMessage(err));
    }
    after();
  };

  return (
    <div className="page">
      <PageHead
        title="Holding area"
        sub="Items moved aside instead of deleted. Put them back any time, or purge them to free the space."
        actions={
          held.length > 0 && (
            <>
              <button type="button" className="btn" onClick={() => restore(held)}>
                <ArchiveRestore />
                Restore all
              </button>
              <button type="button" className="btn danger" onClick={() => setConfirm(held)}>
                <Trash2 />
                Purge all
              </button>
            </>
          )
        }
      />

      {held.length > 0 && (
        <div className="tiles" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))", marginBottom: 14 }}>
          <div className="tile">
            <span className="k">On hold</span>
            <span className="v">{formatSize(sum(held))}</span>
            <span className="d">{held.length} items, still using disk space</span>
          </div>
          <div className="tile">
            <span className="k">Oldest batch</span>
            <span className="v" style={{ fontSize: 20 }}>{held[0]?.batch.slice(0, 10)}</span>
            <span className="d">purge when you are sure</span>
          </div>
          <div className="tile" style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
            <Info size={18} className="muted" style={{ flex: "none" }} />
            <span className="muted" style={{ fontSize: 12.5 }}>Holding moves items within the same drive, so it is instant. Space comes back only after a purge.</span>
          </div>
        </div>
      )}

      <section className="card">
        {held.length === 0 ? (
          <Empty icon={<Archive size={22} />} title="Nothing on hold" body="Choose Move to holding on any finding to set it aside safely. You can restore it later or purge it for good." />
        ) : (
          <table className="grid-table">
            <thead>
              <tr>
                <th className="w">
                  <Checkbox state={allState} onChange={() => setSelected(allState === true ? new Set() : new Set(held.map((h) => h.held)))} label="Select all" />
                </th>
                <th>Item</th>
                <th>Held since</th>
                <th className="r">Size</th>
                <th className="w" />
              </tr>
            </thead>
            <tbody>
              {held.map((h) => (
                <tr key={h.held}>
                  <td className="w">
                    <Checkbox state={selected.has(h.held)} onChange={() => toggle(h.held)} label={`Select ${baseName(h.original)}`} />
                  </td>
                  <td>
                    <div className="name">
                      <b className="truncate">{baseName(h.original)}</b>
                      <span className="where truncate">{shortPath(dirName(h.original))}</span>
                    </div>
                  </td>
                  <td className="muted">{h.batch.slice(0, 10)}</td>
                  <td className="r mono">{formatSize(h.size)}</td>
                  <td className="w">
                    <div style={{ display: "flex", gap: 4 }}>
                      <button type="button" className="btn sm" onClick={() => restore([h])}>
                        <ArchiveRestore />
                        Restore
                      </button>
                      <button type="button" className="btn sm ghost icon" aria-label={`Purge ${baseName(h.original)}`} onClick={() => setConfirm([h])}>
                        <Trash2 />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {chosen.length > 0 && (
        <div className="actionbar" role="toolbar" aria-label="Selection">
          <span className="sel">
            <b>{chosen.length}</b> selected · <b className="mono">{formatSize(sum(chosen))}</b>
          </span>
          <span className="sep" />
          <button type="button" className="btn" onClick={() => restore(chosen)}>
            <ArchiveRestore />
            Restore
          </button>
          <button type="button" className="btn danger solid" onClick={() => setConfirm(chosen)}>
            <Trash2 />
            Purge
          </button>
        </div>
      )}

      <Dialog
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        tone="danger"
        icon={<Trash2 size={18} />}
        title={`Purge ${confirm?.length ?? 0} held item${confirm?.length === 1 ? "" : "s"}?`}
        body={
          <>
            They are deleted for good and <b className="mono">{formatSize(sum(confirm ?? []))}</b> comes back on the drive.
          </>
        }
        footer={
          <>
            <button type="button" className="btn" data-autofocus onClick={() => setConfirm(null)}>
              Cancel
            </button>
            <button type="button" className="btn danger solid" onClick={() => confirm && purge(confirm)}>
              <Trash2 />
              Purge {confirm?.length ?? 0}
            </button>
          </>
        }
      />
    </div>
  );
}
