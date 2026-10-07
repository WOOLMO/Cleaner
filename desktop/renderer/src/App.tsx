import { useEffect } from "react";
import { boot, buildNetwork, go, loadGraph, planOrganize, setProtect, startScan, startThreatScan, store, useStore, type Page } from "./store";
import { TitleBar, Rail } from "./components/Shell";
import { Palette } from "./components/Palette";
import { BrandMark, Toasts } from "./components/ui";
import { Overview } from "./pages/Overview";
import { ScanPage } from "./pages/Scan";
import { SpaceMap } from "./pages/SpaceMap";
import { Organize } from "./pages/Organize";
import { Protection } from "./pages/Protection";
import { FolderGraph } from "./pages/FolderGraph";
import { Holding } from "./pages/Holding";
import { Activity } from "./pages/Activity";
import { SettingsPage } from "./pages/Settings";

const PAGES: Record<Page, () => React.JSX.Element | null> = {
  overview: Overview,
  scan: ScanPage,
  protect: Protection,
  organize: Organize,
  map: SpaceMap,
  graph: FolderGraph,
  holding: Holding,
  activity: Activity,
  settings: SettingsPage,
};
const ORDER: Page[] = ["overview", "scan", "protect", "organize", "map", "graph", "holding", "activity", "settings"];

function useTheme() {
  const theme = useStore((s) => s.settings?.settings.theme ?? "system");
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && media.matches);
      document.documentElement.dataset.theme = dark ? "dark" : "light";
      const css = getComputedStyle(document.documentElement);
      window.cleanerWindow?.setTitleBar({ color: css.getPropertyValue("--bg").trim(), symbolColor: css.getPropertyValue("--text-2").trim() });
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        store.set((s) => ({ palette: !s.palette }));
      } else if (e.ctrlKey && /^[1-9]$/.test(e.key)) {
        e.preventDefault();
        go(ORDER[Number(e.key) - 1]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

// Screenshot mode drives the app page by page (see main.js); only ever used with sample data.
function useCaptureNavigation() {
  useEffect(
    () =>
      window.cleanerWindow?.onNavigate((target) => {
        if (target === "results") store.set({ page: "scan", scanView: "results" });
        else if (target === "detail") store.set({ page: "scan", scanView: "results", focus: { id: 2 } });
        else if (target === "confirm") store.set({ page: "scan", scanView: "results", focus: { id: 2, confirm: true } });
        else if (target === "scan") store.set({ page: "scan", scanView: "setup" });
        else if (target === "running") {
          const home = store.get().info?.home;
          if (home) startScan([home]);
        } else if (target === "organize-plan") {
          const home = store.get().info?.home;
          store.set({ page: "organize" });
          if (home) planOrganize(`${home}\\Desktop`);
        } else if (target.startsWith("graph-")) {
          // the folder graph in use: a folder opened, the rings layout, a search
          const home = store.get().info?.home ?? "";
          const detail = target === "graph-open" ? { open: `${home}\\code` } : target === "graph-rings" ? { layout: "rings" } : { layout: "web", query: "screen" };
          const send = () => window.dispatchEvent(new CustomEvent("cleaner:graph-demo", { detail }));
          store.set({ page: "graph" });
          if (store.get().graph.tree) send();
          else if (home) loadGraph(home).then(() => setTimeout(send, 50));
        } else if (target === "network" || target === "network-drive") {
          store.set({ page: "graph" });
          const home = store.get().info?.home;
          if (home) buildNetwork(target === "network" ? home : "C:\\");
        } else if (target === "protect-detail") {
          store.set({ page: "protect" });
          setProtect({ tab: "findings", focus: 3 });
        } else if (target === "protect-startup") {
          store.set({ page: "protect" });
          setProtect({ tab: "startup", focus: null });
        } else if (target === "protect-running") startThreatScan("quick");
        else if (target === "palette") store.set({ palette: true });
        else go(target as Page);
      }),
    [],
  );
}

export function App() {
  const ready = useStore((s) => s.ready);
  const page = useStore((s) => s.page);
  useTheme();
  useShortcuts();
  useCaptureNavigation();
  useEffect(() => {
    boot();
  }, []);

  if (!ready) {
    return (
      <div style={{ height: "100%", display: "grid", placeItems: "center" }}>
        <BrandMark size={44} />
      </div>
    );
  }
  const Current = PAGES[page];
  return (
    <div className="shell">
      <TitleBar />
      <Rail />
      <main className="work" key={page}>
        <Current />
      </main>
      <Palette />
      <Toasts />
    </div>
  );
}
