import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Archive, Download, FileText, FolderTree, Gauge, History, LayoutGrid, Moon, Play, Radar, ScanSearch, Search, Settings, ShieldCheck, Sun, Wand2 } from "lucide-react";
import { api } from "../api";
import { go, loadGraph, planOrganize, saveSettings, startMap, startScan, startThreatScan, store, toast, useStore } from "../store";

interface Command {
  id: string;
  label: string;
  hint?: string;
  icon: ReactNode;
  run: () => void;
}

// Ctrl+K: every page and the main actions, filtered as you type.
export function Palette() {
  const open = useStore((s) => s.palette);
  const info = useStore((s) => s.info);
  const hasScan = useStore((s) => Boolean(s.scan));
  const theme = useStore((s) => s.settings?.settings.theme);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [
      { id: "scan-home", label: "Scan my user folder", hint: "Scan", icon: <Play />, run: () => info && startScan([info.home]) },
      { id: "map-c", label: "Map drive C:", hint: "Space map", icon: <LayoutGrid />, run: () => startMap("C:\\") },
      { id: "threat-quick", label: "Quick threat scan", hint: "Protection", icon: <Radar />, run: () => startThreatScan("quick") },
      { id: "threat-full", label: "Full threat scan of my user folder", hint: "Protection", icon: <ShieldCheck />, run: () => startThreatScan("full") },
      { id: "organize-desktop", label: "Organize my Desktop", hint: "Organize", icon: <Wand2 />, run: () => { go("organize"); api.organizePlaces().then((p) => { const d = p.find((x) => x.id === "desktop"); if (d) planOrganize(d.path); }); } },
      { id: "graph-home", label: "Graph my user folder", hint: "Folder graph", icon: <FolderTree />, run: () => { go("graph"); if (info) loadGraph(info.home); } },
      { id: "overview", label: "Go to Overview", icon: <Gauge />, run: () => go("overview") },
      { id: "scan", label: "Go to Scan", icon: <ScanSearch />, run: () => go("scan") },
      { id: "protect", label: "Go to Protection", icon: <ShieldCheck />, run: () => go("protect") },
      { id: "organize", label: "Go to Organize", icon: <Wand2 />, run: () => go("organize") },
      { id: "map", label: "Go to Space map", icon: <LayoutGrid />, run: () => go("map") },
      { id: "graph", label: "Go to Folder graph", icon: <FolderTree />, run: () => go("graph") },
      { id: "holding", label: "Go to Holding area", icon: <Archive />, run: () => go("holding") },
      { id: "activity", label: "Go to Activity", icon: <History />, run: () => go("activity") },
      { id: "settings", label: "Go to Settings", icon: <Settings />, run: () => go("settings") },
      {
        id: "theme",
        label: theme === "light" ? "Switch to dark theme" : "Switch to light theme",
        icon: theme === "light" ? <Moon /> : <Sun />,
        run: () => saveSettings({ theme: theme === "light" ? "dark" : "light" }),
      },
    ];
    if (hasScan) {
      list.push(
        { id: "script", label: "Write removal script to Desktop", hint: "Export", icon: <FileText />, run: () => api.exportScript().then((f) => toast("ok", "Removal script saved", f.ps1)) },
        { id: "report", label: "Export HTML report", hint: "Export", icon: <Download />, run: () => api.exportReport("html") },
      );
    }
    return list;
  }, [info, hasScan, theme]);

  const shown = commands.filter((c) => c.label.toLowerCase().includes(query.trim().toLowerCase()));

  useEffect(() => {
    if (open) {
      setQuery("");
      setIndex(0);
    }
  }, [open]);

  if (!open) return null;
  const close = () => store.set({ palette: false });
  const run = (c: Command) => {
    close();
    c.run();
  };

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="palette" role="dialog" aria-label="Command palette">
        <Search className="search-ico" />
        <input
          autoFocus
          placeholder="Type a command or page"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") close();
            else if (e.key === "ArrowDown") {
              e.preventDefault();
              setIndex((i) => Math.min(shown.length - 1, i + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setIndex((i) => Math.max(0, i - 1));
            } else if (e.key === "Enter" && shown[index]) run(shown[index]);
          }}
        />
        <ul role="listbox">
          {shown.map((c, i) => (
            <li key={c.id}>
              <button type="button" role="option" aria-selected={i === index} onMouseEnter={() => setIndex(i)} onClick={() => run(c)}>
                {c.icon}
                {c.label}
                {c.hint && <span className="hint">{c.hint}</span>}
              </button>
            </li>
          ))}
          {!shown.length && <li className="muted" style={{ padding: "14px 12px" }}>No matching command</li>}
        </ul>
      </div>
    </div>
  );
}
