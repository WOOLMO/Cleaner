import { Archive, Building2, FolderTree, Gauge, History, LayoutGrid, LoaderCircle, ScanSearch, Search, Settings, Wand2 } from "lucide-react";
import type { ReactNode } from "react";
import { go, store, useStore, type Page } from "../store";
import { formatSize } from "../format";
import { BrandMark } from "./ui";

export function TitleBar() {
  return (
    <header className="titlebar">
      <div className="brand">
        <BrandMark />
        Cleaner
      </div>
      <button type="button" className="search-trigger" onClick={() => store.set({ palette: true })}>
        <Search size={15} />
        <span>Search actions and pages</span>
        <span className="kbd">Ctrl K</span>
      </button>
      <div />
    </header>
  );
}

const NAV: { page: Page; label: string; icon: ReactNode }[] = [
  { page: "overview", label: "Overview", icon: <Gauge size={17} /> },
  { page: "scan", label: "Scan", icon: <ScanSearch size={17} /> },
  { page: "organize", label: "Organize", icon: <Wand2 size={17} /> },
  { page: "map", label: "Space map", icon: <LayoutGrid size={17} /> },
  { page: "graph", label: "Folder graph", icon: <FolderTree size={17} /> },
  { page: "holding", label: "Holding area", icon: <Archive size={17} /> },
  { page: "activity", label: "Activity", icon: <History size={17} /> },
];

export function Rail() {
  const page = useStore((s) => s.page);
  const scanRunning = useStore((s) => s.scanRunning);
  const mapRunning = useStore((s) => s.mapRunning);
  const held = useStore((s) => s.held);
  const drives = useStore((s) => s.drives);
  const settings = useStore((s) => s.settings);
  const orgBusy = useStore((s) => s.org.planning || s.org.applying);
  const graphBusy = useStore((s) => s.graph.loading);
  const busy: Partial<Record<Page, boolean>> = { scan: scanRunning, map: mapRunning, organize: orgBusy, graph: graphBusy };
  const counts: Partial<Record<Page, number>> = { holding: held.length };

  return (
    <nav className="rail" aria-label="Main">
      {NAV.map((n) => (
        <button key={n.page} type="button" className="nav" aria-current={page === n.page ? "page" : undefined} onClick={() => go(n.page)}>
          {n.icon}
          {n.label}
          {busy[n.page] ? <LoaderCircle className="live" /> : counts[n.page] ? <span className="count">{counts[n.page]}</span> : null}
        </button>
      ))}
      <div className="rail-label">System</div>
      <button type="button" className="nav" aria-current={page === "settings" ? "page" : undefined} onClick={() => go("settings")}>
        <Settings size={17} />
        Settings
      </button>

      <div className="rail-foot">
        {settings?.policy.managed && (
          <div className="managed" title={settings.policy.source}>
            <Building2 size={15} />
            <span className="truncate">Managed by {settings.policy.organization ?? "your organization"}</span>
          </div>
        )}
        {drives.slice(0, 2).map((d) => {
          const used = d.total - d.free;
          return (
            <div className="drive-mini" key={d.root}>
              <header>
                <b>Drive {d.letter}:</b>
                <span className="muted num">{formatSize(d.free)} free</span>
              </header>
              <div className="meter thin">
                <i style={{ width: `${(used / d.total) * 100}%`, background: used / d.total > 0.9 ? "var(--red)" : "var(--text-3)" }} />
              </div>
            </div>
          );
        })}
      </div>
    </nav>
  );
}
