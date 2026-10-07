import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Activity, ArrowUpRight, Check, ChevronDown, ChevronRight, CircleMinus, Clock, Cpu, Download, ExternalLink, Eye, FileWarning, Fingerprint, FolderOpen, Globe,
  HardDriveDownload, Info, KeyRound, LoaderCircle, Lock, Power, Radar, RefreshCw, ScanSearch, ShieldAlert, ShieldCheck, ShieldX, Sparkles, Trash2, Undo2, X,
} from "lucide-react";
import { api } from "../api";
import {
  cancelThreatScan, clearServiceKey, deleteQuarantine, endProcess, loadProtect, lookupItem, quarantineItems, restoreQuarantine, saveSettings, setProtect, setServiceKey,
  setupYara, startThreatScan, trustItem, updateIntel, useStore, watchDismiss, watchQuarantine, type ThreatProgress,
} from "../store";
import { Checkbox, Dialog, Empty, PageHead, Segmented } from "../components/ui";
import { baseName, dirName, displayRoot, duration, formatCount, formatSize, shortPath, timeAgo } from "../format";
import type { LiveProcess, ProtectStatus, ServiceName, Severity, StartupEntry, ThreatResult, ThreatScan } from "../types";

const SEV: Record<Severity, { label: string; icon: ReactNode; badge: string }> = {
  threat: { label: "Threat", icon: <ShieldX size={18} />, badge: "red" },
  suspicious: { label: "Suspicious", icon: <ShieldAlert size={18} />, badge: "amber" },
  notice: { label: "Notice", icon: <Info size={18} />, badge: "" },
};
const SOURCE: Record<string, string> = {
  hash: "Known-bad hash list", defender: "Microsoft Defender", malwarebazaar: "MalwareBazaar", virustotal: "VirusTotal", "malwarebazaar-feed": "MalwareBazaar feed",
  urlhaus: "URLhaus", loldrivers: "LOLDrivers", yara: "YARA (YARA Forge)", hashlookup: "CIRCL hashlookup", feodo: "Feodo Tracker",
};
const STARTUP_SOURCE: Record<StartupEntry["source"], string> = {
  registry: "Run key", "startup-folder": "Startup folder", task: "Scheduled task", service: "Service", winlogon: "Winlogon", debugger: "Debugger hijack", wmi: "WMI event",
};
const PHASES: { id: ThreatProgress["phase"]; label: string }[] = [
  { id: "intel", label: "Threat intel" },
  { id: "autostart", label: "Startup entries" },
  { id: "walk", label: "Finding files" },
  { id: "inspect", label: "Looking inside" },
  { id: "signatures", label: "Signatures" },
  { id: "defender", label: "Defender engine" },
  { id: "yara", label: "YARA rules" },
  { id: "reputation", label: "Malware databases" },
  { id: "ai", label: "Gemini review" },
  { id: "behavior", label: "Running programs" },
];
const plural = (n: number, w: string) => `${formatCount(n)} ${w}${n === 1 ? "" : "s"}`;

export function Protection() {
  const p = useStore((s) => s.protect);
  const info = useStore((s) => s.info);

  useEffect(() => {
    loadProtect();
  }, []);

  const pick = async () => {
    const dir = await api.pickFolder("Choose a folder to scan for threats");
    if (dir) startThreatScan("custom", [dir]);
  };

  return (
    <div className="page">
      <PageHead
        title="Protection"
        sub="An on-demand second opinion next to your antivirus. It explains every finding, and nothing is moved without you."
        actions={
          <>
            <button type="button" className="btn" onClick={pick} disabled={p.running}>
              <FolderOpen />
              Scan a folder
            </button>
            <button type="button" className="btn" onClick={() => startThreatScan("full")} disabled={p.running}>
              <ScanSearch />
              Full scan
            </button>
            <button type="button" className="btn primary" onClick={() => startThreatScan("quick")} disabled={p.running}>
              <Radar />
              Quick scan
            </button>
          </>
        }
      />
      {p.running && p.progress ? (
        <Running progress={p.progress} />
      ) : (
        <>
          <Hero scan={p.scan} status={p.status} home={info?.home ?? ""} />
          <WatchPanel />
          {p.scan ? <Tabs scan={p.scan} /> : null}
        </>
      )}
    </div>
  );
}

// ---------- status ----------
function Hero({ scan, status, home }: { scan: ThreatScan | null; status: ProtectStatus | null; home: string }) {
  const s = scan?.stats;
  const tone = !scan ? "idle" : s!.threats ? "threat" : s!.suspicious ? "warn" : "clean";
  const title = !scan ? "No threat scan yet" : s!.threats ? `${plural(s!.threats, "threat")} found` : s!.suspicious ? `${plural(s!.suspicious, "file")} worth a look` : "No threats found";
  const icon = tone === "threat" ? <ShieldX size={34} /> : tone === "warn" ? <ShieldAlert size={34} /> : <ShieldCheck size={34} />;
  return (
    <div className="pr-top">
      <section className={`card pr-hero ${tone}`}>
        <div className="pr-shield">
          <span className="pr-pulse" />
          <span className="pr-pulse two" />
          {icon}
        </div>
        <div className="pr-hero-text">
          <h2>{title}</h2>
          {scan ? (
            <p className="muted">
              {scan.mode === "quick" ? "Quick scan" : scan.mode === "full" ? "Full scan" : `Scan of ${scan.roots.map(displayRoot).join(", ")}`} · {timeAgo(scan.finishedAt)} · {formatCount(s!.inspected)} files in {duration(scan.durationMs)}
            </p>
          ) : (
            <p className="muted">A quick scan checks what starts with Windows, your Downloads, Desktop, temp folders and AppData in about a minute.</p>
          )}
          {scan && (
            <div className="pr-counts">
              <span className={s!.threats ? "red" : ""}>
                <b className="num">{s!.threats}</b> threats
              </span>
              <span className={s!.suspicious ? "amber" : ""}>
                <b className="num">{s!.suspicious}</b> suspicious
              </span>
              <span>
                <b className="num">{s!.notices}</b> notices
              </span>
              <span>
                <b className="num">{formatCount(s!.signed)}</b> verified signatures
              </span>
              <span>
                <b className="num">{s!.startups}</b> startup entries
              </span>
            </div>
          )}
          {!scan && home && (
            <button type="button" className="btn primary" style={{ marginTop: 6, alignSelf: "flex-start" }} onClick={() => startThreatScan("quick")}>
              <Radar />
              Run a quick scan
            </button>
          )}
        </div>
      </section>
      <Engines status={status} scan={scan} />
    </div>
  );
}

function Engines({ status, scan }: { status: ProtectStatus | null; scan: ThreatScan | null }) {
  const settings = useStore((s) => s.settings);
  const setup = useStore((s) => s.protect.setup);
  const [keyFor, setKeyFor] = useState<ServiceName | null>(null);
  const [confirmYara, setConfirmYara] = useState(false);
  const ai = Boolean(settings?.settings.aiEnabled && settings.key.hasKey);
  const online = Boolean(settings?.settings.aiEnabled);
  const feeds = status?.intel ? Object.values(status.intel) : [];
  const loaded = feeds.filter((f) => f.count > 0);
  const newest = loaded.map((f) => f.updated).filter(Boolean).sort().pop() ?? null;
  const yara = status?.yara;
  const rows: { name: string; on: boolean; detail: string; action?: ReactNode }[] = [
    { name: "Cleaner rules", on: true, detail: "Programs, scripts, shortcuts, zips, macros, signatures" },
    {
      name: "Open threat intel",
      on: loaded.length > 0,
      detail: loaded.length
        ? `${loaded.length} feeds · ${formatCount(loaded.reduce((s, f) => s + f.count, 0))} entries · ${newest ? timeAgo(newest) : ""}`
        : online ? "abuse.ch and LOLDrivers, downloaded on the next scan" : "Off: online checks are turned off",
      action: (
        <button type="button" className="btn sm ghost" disabled={Boolean(setup) || !online} onClick={() => updateIntel()}>
          <RefreshCw />
          Update
        </button>
      ),
    },
    {
      name: "YARA rules",
      on: Boolean(yara?.ready),
      detail: yara?.ready ? `${formatCount(yara.rules?.count ?? 0)} YARA Forge rules · ${yara.rules?.release ?? ""}` : "The researchers' pattern engine, free",
      action: (
        <button type="button" className="btn sm ghost" disabled={Boolean(setup) || !online} onClick={() => (yara?.ready ? setupYara("update") : setConfirmYara(true))}>
          {yara?.ready ? <RefreshCw /> : <Download />}
          {yara?.ready ? "Update" : "Install"}
        </button>
      ),
    },
    {
      name: "Microsoft Defender engine",
      on: Boolean(status?.defender.available),
      detail: status ? (status.defender.available ? `Engine ${status.defender.engine ?? ""}`.trim() : status.defender.reason ?? "Not available") : "Checking…",
    },
    ...(["malwareBazaar", "virusTotal"] as ServiceName[]).map((name) => {
      const k = status?.keys[name];
      return {
        name: name === "malwareBazaar" ? "MalwareBazaar lookups" : "VirusTotal lookups",
        on: Boolean(k?.hasKey) && online,
        detail: k?.hasKey ? (online ? `Hash lookups on${name === "virusTotal" ? ", 4 a minute" : ""}` : "Off: online checks are turned off") : "Free key, sends hashes only",
        action: (
          <button type="button" className="btn sm ghost" onClick={() => setKeyFor(name)}>
            <KeyRound />
            {k?.hasKey ? "Key" : "Add key"}
          </button>
        ),
      };
    }),
    { name: "CIRCL hashlookup", on: online, detail: online ? "Known-good and known-bad files, by hash" : "Off: online checks are turned off" },
    { name: "Behavior analysis", on: true, detail: "Running programs, connections, drivers" },
    { name: "Gemini second opinion", on: ai, detail: ai ? "Reviews flagged files by name and findings" : settings?.locks.aiEnabled ? "Turned off by your organization" : "Add a Gemini key in Settings" },
  ];
  return (
    <section className="card pr-engines">
      <div className="card-head">
        <h2>Engines</h2>
        {setup ? (
          <span className="sub pr-setup">
            <LoaderCircle size={12} className="spin" />
            {setup}
          </span>
        ) : (
          scan?.engines.aiError && <span className="sub" title={scan.engines.aiError}>Gemini had a problem last time</span>
        )}
      </div>
      <ul>
        {rows.map((r) => (
          <li key={r.name}>
            <span className={`pe-ico ${r.on ? "on" : ""}`}>{r.on ? <Check size={13} /> : <CircleMinus size={13} />}</span>
            <div className="truncate">
              <b>{r.name}</b>
              <span className="muted truncate" title={r.detail}>{r.detail}</span>
            </div>
            {r.action}
          </li>
        ))}
      </ul>
      {keyFor && <KeyDialog name={keyFor} status={status} onClose={() => setKeyFor(null)} />}
      <Dialog
        open={confirmYara}
        onClose={() => setConfirmYara(false)}
        tone="accent"
        icon={<Download size={18} />}
        title="Install YARA?"
        body="Cleaner downloads VirusTotal's official YARA engine (about 2 MB) and the YARA Forge core rules (about 2 MB) from GitHub. Each file must match the checksum GitHub publishes for it, or nothing is installed."
        footer={
          <>
            <button type="button" className="btn ghost" data-autofocus onClick={() => setConfirmYara(false)}>
              Not now
            </button>
            <button
              type="button"
              className="btn primary"
              onClick={() => {
                setConfirmYara(false);
                setupYara("install");
              }}
            >
              <Download />
              Download and install
            </button>
          </>
        }
      />
    </section>
  );
}

function KeyDialog({ name, status, onClose }: { name: ServiceName; status: ProtectStatus | null; onClose: () => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const k = status?.keys[name];
  const label = name === "malwareBazaar" ? "MalwareBazaar" : "VirusTotal";
  const link = name === "malwareBazaar" ? "https://auth.abuse.ch/" : "https://www.virustotal.com/gui/my-apikey";
  const save = async () => {
    setBusy(true);
    const r = await setServiceKey(name, value.trim());
    setBusy(false);
    if (r.ok) onClose();
    else setError(r.message);
  };
  return (
    <Dialog
      open
      onClose={onClose}
      tone="accent"
      icon={<KeyRound size={18} />}
      title={`${label} key`}
      body={
        name === "malwareBazaar"
          ? "MalwareBazaar is abuse.ch's free database of malware samples. Cleaner sends it the SHA-256 fingerprint of flagged files, never the files."
          : "VirusTotal checks a fingerprint against 70+ antivirus engines. The free key allows 4 lookups a minute. Only SHA-256 fingerprints are sent."
      }
      footer={
        <>
          {k?.hasKey && (
            <button type="button" className="btn ghost" style={{ marginRight: "auto" }} onClick={() => clearServiceKey(name).then(onClose)}>
              Remove key
            </button>
          )}
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" disabled={!value.trim() || busy} onClick={save}>
            {busy ? <LoaderCircle className="spin" /> : <Lock />}
            Save encrypted
          </button>
        </>
      }
    >
      <div style={{ display: "grid", gap: 8 }}>
        {k?.hasKey && <p className="muted" style={{ margin: 0 }}>A key is saved ({k.hint}). Paste a new one to replace it.</p>}
        <input className="input mono" data-autofocus placeholder="Paste your free key" value={value} onChange={(e) => (setValue(e.target.value), setError(null))} onKeyDown={(e) => e.key === "Enter" && value.trim() && save()} />
        {error && <p style={{ margin: 0, color: "var(--red)", fontSize: 12.5 }}>{error}</p>}
        <button type="button" className="btn sm ghost" style={{ justifySelf: "start" }} onClick={() => api.openExternal(link)}>
          Get a free key
          <ArrowUpRight />
        </button>
      </div>
    </Dialog>
  );
}

// Watch mode: new files and new startup entries are checked while Cleaner is open.
function WatchPanel() {
  const settings = useStore((s) => s.settings);
  const events = useStore((s) => s.protect.watch).filter((e) => e.status === "found");
  const on = Boolean(settings?.settings.watch);
  return (
    <section className="card pr-watch">
      <div className="pw-head">
        <span className={`pw-pulse ${on ? "on" : ""}`}>
          <Eye size={16} />
        </span>
        <div className="truncate">
          <b>Watch mode</b>
          <span className="muted truncate">
            {on ? "Checking new files in Downloads, Desktop and Startup, and new startup entries, while Cleaner is open" : "Off: new files are only checked when you scan"}
          </span>
        </div>
        <button type="button" className="switch" role="switch" aria-checked={on} aria-label="Watch for threats while Cleaner is open" onClick={() => saveSettings({ watch: !on })} />
      </div>
      {events.length > 0 && (
        <ul className="pw-list">
          {events.slice(0, 5).map((e) => (
            <li key={e.id}>
              <span className={`pg-ico ${e.severity === "clean" ? "" : e.severity}`}>{e.kind === "startup" ? <Power size={15} /> : <ShieldAlert size={15} />}</span>
              <div className="truncate">
                <div className="pl-name truncate">{e.name}</div>
                <div className="pl-why truncate">
                  {e.reason} · {timeAgo(e.time)}
                </div>
              </div>
              <div className="pq-actions">
                <button type="button" className="btn sm" onClick={() => api.reveal(e.path)}>
                  <FolderOpen />
                  Show
                </button>
                {e.kind === "file" && (
                  <button type="button" className="btn sm danger" onClick={() => watchQuarantine(e.id)}>
                    <Lock />
                    Quarantine
                  </button>
                )}
                <button type="button" className="btn sm ghost" onClick={() => watchDismiss(e.id)}>
                  Dismiss
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------- running ----------
function Running({ progress: pr }: { progress: ThreatProgress }) {
  const current = PHASES.findIndex((x) => x.id === pr.phase);
  const detail =
    pr.phase === "walk" ? `${formatCount(pr.files)} files seen, ${formatCount(pr.candidates)} to inspect`
    : pr.phase === "inspect" ? `${formatCount(pr.inspected)} of ${formatCount(pr.total)} inspected`
    : pr.phase === "signatures" ? "Checking who signed each program"
    : pr.phase === "autostart" ? "Reading Run keys, Startup folders, tasks and services"
    : pr.phase === "intel" ? "Refreshing the open threat-intel feeds"
    : pr.phase === "behavior" ? "Looking at running programs, connections and drivers"
    : pr.phase === "yara" ? "Matching files against the YARA rules"
    : pr.step ? `${pr.step.done} of ${pr.step.total}` : "Working";
  const pct = pr.phase === "inspect" && pr.total ? pr.inspected / pr.total : null;
  return (
    <section className="card pr-running">
      <div className="pr-radar" aria-hidden="true">
        <i className="sweep" />
        <i className="grid" />
        <i className="blip one" />
        <i className="blip two" />
        <i className="blip three" />
      </div>
      <div className="pr-run-body">
        <h2>Scanning</h2>
        <p className="muted">{detail}</p>
        {pct !== null && (
          <div className="meter" style={{ marginTop: 4 }}>
            <i style={{ width: `${Math.round(pct * 100)}%`, background: "var(--accent)" }} />
          </div>
        )}
        <p className="mono faint truncate pr-current" title={pr.current}>{pr.current ? shortPath(pr.current) : " "}</p>
        <ol className="pr-phases">
          {PHASES.map((x, i) => {
            const state = pr.done.has(x.id) || i < current ? "done" : i === current ? "now" : "next";
            return (
              <li key={x.id} className={state}>
                <span className="pp-ico">{state === "done" ? <Check size={12} /> : state === "now" ? <LoaderCircle size={12} className="spin" /> : null}</span>
                {x.label}
                {x.id === "autostart" && pr.startups > 0 && <span className="faint"> · {pr.startups}</span>}
                {x.id === "signatures" && pr.signatures > 0 && <span className="faint"> · {formatCount(pr.signatures)}</span>}
              </li>
            );
          })}
        </ol>
        <div className="pr-run-foot">
          <span className="faint">
            <Clock size={13} /> started {timeAgo(pr.startedAt)}
          </span>
          <button type="button" className="btn sm" onClick={() => cancelThreatScan()}>
            Cancel
          </button>
        </div>
      </div>
    </section>
  );
}

// ---------- tabs ----------
function Tabs({ scan }: { scan: ThreatScan }) {
  const tab = useStore((s) => s.protect.tab);
  const quarantine = useStore((s) => s.protect.quarantine);
  const open = scan.results.filter((r) => r.status === "found");
  const flaggedStartups = scan.startups.filter((x) => x.severity !== "clean" && x.severity !== "missing").length;
  const liveFlags = (scan.behavior?.processes.filter((p) => !p.ended).length ?? 0) + (scan.behavior?.drivers.length ?? 0);
  return (
    <>
      <div className="pr-tabs">
        <Segmented
          label="Protection view"
          value={tab}
          onChange={(t) => setProtect({ tab: t, focus: null })}
          options={[
            { value: "findings", label: "Findings", count: open.length },
            { value: "live", label: "Running now", count: liveFlags },
            { value: "startup", label: "Starts with Windows", count: scan.startups.length },
            { value: "quarantine", label: "Quarantine", count: quarantine.length },
          ]}
        />
        {tab === "startup" && flaggedStartups > 0 && <span className="muted">{flaggedStartups === 1 ? "1 entry needs" : `${flaggedStartups} entries need`} a look</span>}
      </div>
      {tab === "findings" && <Findings scan={scan} />}
      {tab === "live" && <RunningNow scan={scan} />}
      {tab === "startup" && <Startups scan={scan} />}
      {tab === "quarantine" && <QuarantineList />}
    </>
  );
}

function Findings({ scan }: { scan: ThreatScan }) {
  const focus = useStore((s) => s.protect.focus);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [showNotices, setShowNotices] = useState(false);
  const [confirm, setConfirm] = useState<number[] | null>(null);
  const groups = useMemo(() => {
    const by: Record<Severity, ThreatResult[]> = { threat: [], suspicious: [], notice: [] };
    for (const r of scan.results) by[r.severity].push(r);
    return by;
  }, [scan]);
  const active = focus ? scan.results.find((r) => r.id === focus) ?? null : null;

  if (!scan.results.length) {
    return (
      <section className="card">
        <Empty icon={<ShieldCheck size={22} />} title="Nothing looks like malware" body={`${formatCount(scan.stats.inspected)} files and ${scan.stats.startups} startup entries were checked. Keep your antivirus on for real-time protection.`} />
      </section>
    );
  }
  const toggle = (id: number) => setSelected((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : new Set([...s, id])));
  const chosen = scan.results.filter((r) => selected.has(r.id) && r.status === "found");

  return (
    <>
      {(["threat", "suspicious", "notice"] as Severity[]).map((sev) => {
        const list = groups[sev];
        if (!list.length) return null;
        const collapsed = sev === "notice" && !showNotices;
        return (
          <section key={sev} className={`pr-group ${sev}`}>
            <header>
              <span className={`pg-ico ${sev}`}>{SEV[sev].icon}</span>
              <h2>{sev === "threat" ? "Threats" : sev === "suspicious" ? "Suspicious" : "Notices"}</h2>
              <span className="muted">
                {sev === "threat" ? "Known malware: an engine or a hash list says so" : sev === "suspicious" ? "Strong warning signs, worth checking" : "Weak signs, usually fine"}
              </span>
              {sev === "notice" && (
                <button type="button" className="btn sm ghost" style={{ marginLeft: "auto" }} onClick={() => setShowNotices(!showNotices)}>
                  {collapsed ? <ChevronRight /> : <ChevronDown />}
                  {collapsed ? `Show ${list.length}` : "Hide"}
                </button>
              )}
            </header>
            {!collapsed && (
              <ul className="pr-list">
                {list.map((r, i) => (
                  <li key={r.id} className={`${r.id === focus ? "on" : ""} ${r.status !== "found" ? "handled" : ""}`} style={{ animationDelay: `${Math.min(i, 10) * 30}ms` }} onClick={() => setProtect({ focus: r.id })}>
                    <span onClick={(e) => e.stopPropagation()}>
                      <Checkbox state={selected.has(r.id)} onChange={() => toggle(r.id)} label={`Select ${r.name}`} disabled={r.status !== "found"} />
                    </span>
                    <div className="truncate">
                      <div className="pl-name truncate">
                        {r.name}
                        {r.autostart && <span className="badge blue"><Power size={11} /> Starts with Windows</span>}
                        {r.status === "quarantined" && <span className="badge">Quarantined</span>}
                        {r.status === "trusted" && <span className="badge green">Trusted</span>}
                      </div>
                      <div className="pl-path mono truncate" title={r.path}>{shortPath(dirName(r.path))}</div>
                      <div className="pl-why truncate">
                        {r.detections.length ? <b>{r.detections[0].name}</b> : r.findings.filter((f) => f.counted).slice(0, 3).map((f) => f.label).join(" · ")}
                      </div>
                    </div>
                    <span className="pl-signer truncate muted">{signerText(r)}</span>
                    <span className="mono muted pl-size">{formatSize(r.size)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}

      {active && <Drawer r={active} onQuarantine={() => setConfirm([active.id])} />}

      {chosen.length > 0 && (
        <div className={`actionbar${active ? " beside-drawer" : ""}`} role="toolbar" aria-label="Selection">
          <span className="sel">
            <b>{chosen.length}</b> selected
          </span>
          <button type="button" className="btn sm ghost" onClick={() => setSelected(new Set())}>
            Clear
          </button>
          <span className="sep" />
          <button type="button" className="btn danger solid" onClick={() => setConfirm(chosen.map((r) => r.id))}>
            <Lock />
            Quarantine
          </button>
        </div>
      )}

      <Dialog
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        tone="danger"
        icon={<Lock size={18} />}
        title={`Quarantine ${plural(confirm?.length ?? 0, "file")}?`}
        body="Each file is moved into Cleaner's quarantine and scrambled so it can't run. Programs that need it will stop working until you restore it."
        footer={
          <>
            <button type="button" className="btn ghost" data-autofocus onClick={() => setConfirm(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn danger solid"
              onClick={() => {
                const ids = confirm ?? [];
                setConfirm(null);
                setSelected(new Set());
                quarantineItems(ids);
              }}
            >
              Quarantine
            </button>
          </>
        }
      >
        <ul className="path-list">
          {scan.results.filter((r) => confirm?.includes(r.id)).map((r) => (
            <li key={r.id}>
              <span>{shortPath(r.path)}</span>
              <span>{SEV[r.severity].label}</span>
            </li>
          ))}
        </ul>
      </Dialog>
    </>
  );
}

function signerText(r: ThreatResult) {
  if (!r.signer) return r.kind === "pe" ? "Signature not checked" : "";
  if (r.signer.status === "valid") return `Signed by ${r.signer.subject ?? "a trusted publisher"}`;
  if (r.signer.status === "invalid") return "Broken signature";
  if (r.signer.status === "untrusted") return "Untrusted signature";
  return "Not signed";
}

function Drawer({ r, onQuarantine }: { r: ThreatResult; onQuarantine: () => void }) {
  const counted = r.findings.filter((f) => f.counted);
  const quiet = r.findings.filter((f) => !f.counted);
  const vt = r.reputation.find((x) => x.source === "virustotal");
  const [busy, setBusy] = useState(false);
  return (
    <aside className="drawer pr-drawer" aria-label="Finding details">
      <header>
        <span className={`pg-ico ${r.severity}`}>{SEV[r.severity].icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3>{r.name}</h3>
          <span className={`badge ${SEV[r.severity].badge}`}>{SEV[r.severity].label}</span>
          {r.status === "quarantined" && <span className="badge" style={{ marginLeft: 6 }}>Quarantined</span>}
        </div>
        <button type="button" className="btn ghost icon" aria-label="Close details" onClick={() => setProtect({ focus: null })}>
          <X />
        </button>
      </header>
      <div className="body">
        {r.detections.length > 0 && (
          <div className="why pr-detect">
            <div className="who">
              <ShieldX />
              Detected by
            </div>
            {r.detections.map((d) => (
              <p key={d.source + d.name}>
                <b>{SOURCE[d.source] ?? d.source}</b>: {d.name}
              </p>
            ))}
          </div>
        )}
        {counted.length > 0 && (
          <div className="pr-signs">
            <div className="gd-label">Warning signs</div>
            <ul>
              {counted.map((f) => (
                <li key={f.id}>
                  <span className="ws-weight" style={{ width: `${Math.min(100, f.weight * 16)}%` }} />
                  <div>
                    <b>{f.label}</b>
                    {f.detail && <span className="mono truncate" title={f.detail}>{f.detail}</span>}
                  </div>
                </li>
              ))}
            </ul>
            {quiet.length > 0 && (
              <p className="faint" style={{ margin: "8px 0 0", fontSize: 12 }}>
                Ignored because the publisher signed it: {quiet.map((f) => f.label.toLowerCase()).join("; ")}.
              </p>
            )}
          </div>
        )}
        {r.ai && (
          <div className="why">
            <div className="who">
              <Sparkles />
              Gemini's second opinion
            </div>
            <p>
              <b>{r.ai.verdict === "likely-benign" ? "Likely harmless" : r.ai.verdict === "likely-malicious" ? "Likely malicious" : "Unclear"}</b> ({Math.round(r.ai.confidence * 100)}%). {r.ai.reason}
            </p>
          </div>
        )}
        <dl className="facts">
          <dt>Size</dt>
          <dd className="mono">{formatSize(r.size)}</dd>
          {r.mtime > 0 && (
            <>
              <dt>Last changed</dt>
              <dd>{new Date(r.mtime).toLocaleString()}</dd>
            </>
          )}
          <dt>Signature</dt>
          <dd>{signerText(r) || "Not a program"}</dd>
          {r.zone && (
            <>
              <dt>Came from</dt>
              <dd className="truncate" title={r.zone.url ?? ""}>
                <Globe size={12} style={{ verticalAlign: -1, marginRight: 4 }} />
                {r.zone.url ? new URL(r.zone.url).hostname : r.zone.id >= 3 ? "The internet" : "This network"}
              </dd>
            </>
          )}
          {r.autostart && (
            <>
              <dt>Starts with Windows</dt>
              <dd>
                {STARTUP_SOURCE[r.autostart.source]} “{r.autostart.name}”
              </dd>
            </>
          )}
          {vt?.found && (
            <>
              <dt>VirusTotal</dt>
              <dd style={{ color: (vt.malicious ?? 0) > 0 ? "var(--red)" : "var(--accent)" }}>
                {vt.malicious} of {vt.total} engines flag it{vt.label ? ` (${vt.label})` : ""}
              </dd>
            </>
          )}
          {vt && !vt.found && (
            <>
              <dt>VirusTotal</dt>
              <dd>Never seen before</dd>
            </>
          )}
        </dl>
        {r.sha256 && (
          <div>
            <div className="gd-label" style={{ marginBottom: 6 }}>
              <Fingerprint size={12} style={{ verticalAlign: -2, marginRight: 4 }} />
              SHA-256 fingerprint
            </div>
            <div className="pathbox">{r.sha256}</div>
          </div>
        )}
        <div>
          <div className="gd-label" style={{ marginBottom: 6 }}>Location</div>
          <div className="pathbox">{r.path}</div>
        </div>
      </div>
      <footer className="pr-drawer-foot">
        <button type="button" className="btn" onClick={() => api.reveal(r.path)}>
          <FolderOpen />
          Show
        </button>
        {r.sha256 && (
          <button type="button" className="btn" disabled={busy} onClick={async () => (setBusy(true), await lookupItem(r.id), setBusy(false))}>
            {busy ? <LoaderCircle className="spin" /> : <ExternalLink />}
            VirusTotal
          </button>
        )}
        {r.status === "found" && r.severity !== "threat" && r.sha256 && (
          <button type="button" className="btn ghost" onClick={() => trustItem(r.id)}>
            Trust
          </button>
        )}
        {r.status === "found" && (
          <button type="button" className="btn danger solid" style={{ marginLeft: "auto" }} onClick={onQuarantine}>
            <Lock />
            Quarantine
          </button>
        )}
      </footer>
    </aside>
  );
}

function RunningNow({ scan }: { scan: ThreatScan }) {
  const live = scan.behavior;
  const [end, setEnd] = useState<LiveProcess | null>(null);
  if (!live) {
    return (
      <section className="card">
        <Empty icon={<Activity size={22} />} title="No snapshot in this scan" body="Run a scan to see what is running right now." />
      </section>
    );
  }
  const flagged = live.processes;
  return (
    <>
      <div className="pr-live-stats">
        <span>
          <b className="num">{formatCount(live.stats.processes)}</b> programs running
        </span>
        <span>
          <b className="num">{formatCount(live.stats.external)}</b> internet connections from {live.stats.talkers} programs
        </span>
        <span>
          <b className="num">{formatCount(live.stats.drivers)}</b> drivers loaded
        </span>
        <span className="faint">snapshot taken {timeAgo(scan.finishedAt)}</span>
      </div>
      {!flagged.length && !live.drivers.length ? (
        <section className="card">
          <Empty icon={<ShieldCheck size={22} />} title="Nothing running looks wrong" body="No fake system processes, no hidden encoded commands, no connections to known botnet servers, no abusable drivers." />
        </section>
      ) : null}
      {flagged.length > 0 && (
        <section className={`pr-group ${flagged.some((p) => p.severity === "threat") ? "threat" : "suspicious"}`}>
          <header>
            <span className={`pg-ico ${flagged.some((p) => p.severity === "threat") ? "threat" : "suspicious"}`}>
              <Cpu size={18} />
            </span>
            <h2>Programs</h2>
            <span className="muted">What they do, not just what they are</span>
          </header>
          <ul className="pr-list pr-procs">
            {flagged.map((p) => (
              <li key={p.pid} className={p.ended ? "handled" : ""}>
                <span className={`pg-ico ${p.severity === "clean" ? "" : p.severity}`}>{p.severity === "threat" ? <ShieldX size={16} /> : <ShieldAlert size={16} />}</span>
                <div className="truncate">
                  <div className="pl-name truncate">
                    {p.name}
                    <span className="badge">pid {p.pid}</span>
                    {p.ended && <span className="badge">Ended</span>}
                  </div>
                  <div className="pl-path mono truncate" title={p.path ?? ""}>
                    {p.path ? shortPath(p.path) : "path hidden (needs admin rights)"}
                    {p.parentName ? ` · started by ${p.parentName}` : ""}
                  </div>
                  <div className="pl-why truncate">
                    {p.detections.length ? <b>{p.detections[0].name}</b> : p.findings.map((f) => f.label).join(" · ")}
                  </div>
                  {p.findings.find((f) => f.id === "encoded-command")?.detail && (
                    <div className="pr-decoded mono truncate" title={p.findings.find((f) => f.id === "encoded-command")!.detail!}>
                      decoded: {p.findings.find((f) => f.id === "encoded-command")!.detail}
                    </div>
                  )}
                </div>
                <div className="pq-actions">
                  {p.path && (
                    <button type="button" className="btn sm" onClick={() => api.reveal(p.path!)}>
                      <FolderOpen />
                      Show
                    </button>
                  )}
                  {!p.ended && (
                    <button type="button" className="btn sm danger" onClick={() => setEnd(p)}>
                      <Power />
                      End
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {live.drivers.length > 0 && (
        <section className="pr-group suspicious">
          <header>
            <span className="pg-ico suspicious">
              <HardDriveDownload size={18} />
            </span>
            <h2>Drivers</h2>
            <span className="muted">Checked against LOLDrivers, the open list of abused drivers</span>
          </header>
          <ul className="pr-list pr-procs">
            {live.drivers.map((d) => (
              <li key={d.name}>
                <span className={`pg-ico ${d.severity}`}>
                  <ShieldAlert size={16} />
                </span>
                <div className="truncate">
                  <div className="pl-name truncate">
                    {d.display || d.name}
                    <span className="badge">{d.name}</span>
                  </div>
                  <div className="pl-path mono truncate" title={d.path}>{d.path}</div>
                  <div className="pl-why truncate">{d.label}</div>
                </div>
                <div className="pq-actions">
                  <span className="faint" style={{ fontSize: 12, maxWidth: 220, whiteSpace: "normal" }}>
                    Update or uninstall the app that installed it, or turn on Windows' vulnerable driver blocklist.
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      <Dialog
        open={Boolean(end)}
        onClose={() => setEnd(null)}
        tone="danger"
        icon={<Power size={18} />}
        title={`End ${end?.name ?? "this program"}?`}
        body="Windows stops it right away. Unsaved work in it is lost. Quarantine its file afterwards so it cannot start again."
        footer={
          <>
            <button type="button" className="btn ghost" data-autofocus onClick={() => setEnd(null)}>
              Keep it running
            </button>
            <button
              type="button"
              className="btn danger solid"
              onClick={() => {
                if (end) endProcess(end.pid);
                setEnd(null);
              }}
            >
              End program
            </button>
          </>
        }
      />
    </>
  );
}

function Startups({ scan }: { scan: ThreatScan }) {
  const [filter, setFilter] = useState<"all" | "look" | "missing">("all");
  const [open, setOpen] = useState<number | null>(null);
  const rank = { threat: 0, suspicious: 1, notice: 2, missing: 3, clean: 4 } as const;
  const list = scan.startups
    .filter((x) => (filter === "all" ? true : filter === "missing" ? x.severity === "missing" : x.severity !== "clean" && x.severity !== "missing"))
    .sort((a, b) => rank[a.severity] - rank[b.severity] || a.name.localeCompare(b.name));
  const count = (f: typeof filter) => scan.startups.filter((x) => (f === "all" ? true : f === "missing" ? x.severity === "missing" : x.severity !== "clean" && x.severity !== "missing")).length;
  return (
    <section className="card pr-startups">
      <div className="card-head">
        <Segmented
          label="Filter startup entries"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All", count: count("all") },
            { value: "look", label: "Needs a look", count: count("look") },
            { value: "missing", label: "Missing file", count: count("missing") },
          ]}
        />
        <span className="sub" style={{ marginLeft: "auto" }}>
          Turn entries off in Task Manager, under Startup apps.
        </span>
      </div>
      <div className="ps-table">
        <div className="ps-row ps-head">
          <span>Name</span>
          <span>Type</span>
          <span>Runs</span>
          <span>Publisher</span>
          <span>Status</span>
        </div>
        {list.map((x) => (
          <div key={x.id} className={`ps-item ${open === x.id ? "open" : ""}`}>
            <button type="button" className="ps-row" onClick={() => setOpen(open === x.id ? null : x.id)}>
              <span className="truncate" title={x.name}>
                <b>{x.name}</b>
              </span>
              <span className="muted">{STARTUP_SOURCE[x.source]}</span>
              <span className="mono truncate muted" title={x.target ?? x.command}>{x.target ? shortPath(x.target) : x.command}</span>
              <span className="truncate muted">{x.signer?.status === "valid" ? x.signer.subject : x.signer?.status === "invalid" ? "Broken signature" : x.missing ? "" : "Not signed"}</span>
              <span>
                <StartupBadge s={x.severity} />
              </span>
            </button>
            {open === x.id && (
              <div className="ps-detail">
                <div className="pathbox">{x.command || "(empty)"}</div>
                <p className="muted">
                  {x.reasons.length ? x.reasons.join(" · ") : x.severity === "missing" ? "Points to a file that no longer exists. Harmless, but the entry can go." : "Nothing unusual."} Registered in <span className="mono">{x.location}</span>.
                </p>
                {x.target && !x.missing && (
                  <button type="button" className="btn sm" onClick={() => api.reveal(x.target!)}>
                    <FolderOpen />
                    Show the program
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
        {!list.length && <p className="muted" style={{ padding: "18px 4px" }}>Nothing here.</p>}
      </div>
    </section>
  );
}

function StartupBadge({ s }: { s: StartupEntry["severity"] }) {
  if (s === "clean") return <span className="badge green">OK</span>;
  if (s === "missing") return <span className="badge">Missing file</span>;
  return <span className={`badge ${SEV[s].badge}`}>{SEV[s].label}</span>;
}

function QuarantineList() {
  const list = useStore((s) => s.protect.quarantine);
  const [del, setDel] = useState<string | null>(null);
  if (!list.length) {
    return (
      <section className="card">
        <Empty icon={<Lock size={22} />} title="Quarantine is empty" body="Files you quarantine are moved here and scrambled so they can't run. You can put them back or delete them for good." />
      </section>
    );
  }
  const target = list.find((q) => q.id === del);
  return (
    <section className="card">
      <ul className="list pr-quarantine">
        {list.map((q) => (
          <li key={q.id}>
            <span className={`pg-ico ${q.severity ?? "notice"}`}>
              <FileWarning size={16} />
            </span>
            <div className="truncate">
              <div className="t truncate">{baseName(q.original)}</div>
              <div className="s truncate">
                {q.reason ?? "Quarantined by you"} · {timeAgo(q.time)} · {formatSize(q.size)}
              </div>
              <div className="s mono truncate" title={q.original}>{shortPath(dirName(q.original))}</div>
            </div>
            <div className="pq-actions">
              <button type="button" className="btn sm" onClick={() => restoreQuarantine(q.id)}>
                <Undo2 />
                Restore
              </button>
              <button type="button" className="btn sm danger" onClick={() => setDel(q.id)}>
                <Trash2 />
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
      <Dialog
        open={Boolean(target)}
        onClose={() => setDel(null)}
        tone="danger"
        icon={<Trash2 size={18} />}
        title="Delete for good?"
        body={target ? `${baseName(target.original)} will be permanently deleted. This can't be undone.` : ""}
        footer={
          <>
            <button type="button" className="btn ghost" data-autofocus onClick={() => setDel(null)}>
              Keep it
            </button>
            <button
              type="button"
              className="btn danger solid"
              onClick={() => {
                if (del) deleteQuarantine(del);
                setDel(null);
              }}
            >
              Delete forever
            </button>
          </>
        }
      />
    </section>
  );
}
