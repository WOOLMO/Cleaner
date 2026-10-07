import { useEffect, useRef, type ReactNode } from "react";
import { ArrowRight, FolderTree, KeyRound, ScanSearch, ShieldCheck, Wand2 } from "lucide-react";
import { go, saveSettings, startThreatScan, useStore, type Page } from "../store";
import { BrandMark } from "./ui";

const TOOLS: { page: Page; icon: ReactNode; title: string; body: string }[] = [
  { page: "scan", icon: <ScanSearch />, title: "Clean", body: "Find the caches, copies and leftovers eating your drive. Anything you remove waits in a holding area first." },
  { page: "protect", icon: <ShieldCheck />, title: "Protect", body: "A second opinion beside your antivirus: threat feeds, YARA rules, a look at running programs, and a watch on Downloads." },
  { page: "organize", icon: <Wand2 />, title: "Organize", body: "Sort a messy folder the way you already name things, in your language. Every move can be undone." },
  { page: "graph", icon: <FolderTree />, title: "Map", body: "See where the space goes and how your folders connect, as a treemap or a living graph." },
];

// Shown once, on the first launch. Every choice marks it as seen.
export function Welcome() {
  const welcomed = useStore((s) => s.settings?.settings.welcomed ?? true);
  const ref = useRef<HTMLDivElement>(null);
  const done = (page?: Page) => {
    saveSettings({ welcomed: true });
    if (page) go(page);
  };
  useEffect(() => {
    if (welcomed) return;
    ref.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && done();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [welcomed]);
  if (welcomed) return null;

  return (
    <div className="scrim">
      <div className="welcome" role="dialog" aria-modal="true" aria-labelledby="welcome-title" ref={ref}>
        <header>
          <BrandMark size={40} />
          <div>
            <h2 id="welcome-title">Welcome to Cleaner</h2>
            <p>Four tools for this PC. Everything runs here, and nothing is removed, moved or quarantined until you say so.</p>
          </div>
        </header>
        <div className="welcome-tools">
          {TOOLS.map((t, i) => (
            <button type="button" key={t.page} className="welcome-tool" style={{ animationDelay: `${80 + i * 60}ms` }} onClick={() => done(t.page)}>
              <span className="welcome-icon">{t.icon}</span>
              <b>{t.title}</b>
              <span>{t.body}</span>
              <ArrowRight className="welcome-go" />
            </button>
          ))}
        </div>
        <footer>
          <span className="welcome-note">
            <KeyRound />
            Gemini is optional. Add a free key in Settings for a smarter second look.
          </span>
          <button
            type="button"
            className="btn"
            onClick={() => {
              done("protect");
              startThreatScan("quick");
            }}
          >
            Run a quick threat scan
          </button>
          <button type="button" className="btn primary" data-autofocus onClick={() => done()}>
            Get started
          </button>
        </footer>
      </div>
    </div>
  );
}
