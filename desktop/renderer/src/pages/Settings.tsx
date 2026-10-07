import { useState } from "react";
import { Building2, CircleCheck, Download, ExternalLink, FolderOpen, FolderPlus, KeyRound, LoaderCircle, Monitor, Moon, RefreshCw, RotateCcw, ShieldCheck, Sun, TriangleAlert, X } from "lucide-react";
import { api } from "../api";
import { checkUpdate, errorMessage, installUpdate, saveSettings, store, toast, useStore } from "../store";
import { PageHead, Segmented, Toggle } from "../components/ui";
import { shortPath } from "../format";
import type { Theme, UpdateState } from "../types";

const POLICY_EXAMPLE = `{
  "organization": "Contoso IT",
  "aiEnabled": false,
  "allowPreviews": false,
  "allowPermanentDelete": false,
  "maxAiItems": 200,
  "excludePaths": ["C:\\\\Users\\\\*\\\\Documents\\\\Finance"]
}`;

export function SettingsPage() {
  const view = useStore((s) => s.settings);
  const info = useStore((s) => s.info);
  const [key, setKey] = useState("");
  const [checking, setChecking] = useState(false);
  if (!view || !info) return null;
  const { settings, locks, policy } = view;

  const saveKey = async () => {
    setChecking(true);
    try {
      const r = await api.setKey(key.trim());
      if (r.ok) {
        const { ok: _ok, ...next } = r;
        store.set({ settings: next });
        setKey("");
        toast("ok", "Gemini key saved", "Encrypted with Windows data protection for this account only.");
      } else {
        toast("error", "Google rejected that key", r.message);
      }
    } catch (err) {
      toast("error", "The key was not saved", errorMessage(err));
    }
    setChecking(false);
  };

  const policyRows: [string, string][] = policy.managed
    ? [
        ["Gemini review", policy.aiEnabled === false ? "Turned off" : "Allowed"],
        ["Text previews", policy.allowPreviews === false ? "Turned off" : "Allowed"],
        ["Permanent delete", policy.allowPermanentDelete === false ? "Holding area only" : "Allowed"],
        ["Gemini item limit", policy.maxAiItems !== undefined ? String(policy.maxAiItems) : "Not set"],
        ["Excluded paths", policy.excludePaths.length ? `${policy.excludePaths.length} rules` : "None"],
      ]
    : [];

  return (
    <div className="page">
      <PageHead title="Settings" sub="Applies to this Windows account. Your organization's policy, if any, always wins." />
      <div className="settings">
        <div className="stack">
          <section className="card">
            <div className="card-head">
              <h2>Gemini review</h2>
              <span className="sub">free tier, your own key</span>
            </div>
            <div className="card-body">
              <div className="keybox" style={{ marginBottom: 12 }}>
                {view.key.hasKey ? <CircleCheck style={{ color: "var(--accent)" }} /> : <KeyRound className="muted" />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <b>{view.key.hasKey ? "Key connected" : "No key yet"}</b>
                  <div className="faint" style={{ fontSize: 12 }}>
                    {view.key.source === "secure"
                      ? `${view.key.hint}, encrypted for this Windows account`
                      : view.key.source === "cli"
                        ? `${view.key.hint}, shared with the command line (cleaner setup)`
                        : "Cleaner works without one, using local rules only."}
                  </div>
                </div>
                {view.key.source === "secure" && (
                  <button type="button" className="btn sm ghost" onClick={async () => store.set({ settings: await api.clearKey() })}>
                    Remove
                  </button>
                )}
              </div>
              <div className="field">
                <label htmlFor="key">{view.key.hasKey ? "Replace the key" : "Add a key"}</label>
                <div className="row">
                  <input id="key" className="input mono" type="password" placeholder="Paste your Gemini API key" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" spellCheck={false} />
                  <button type="button" className="btn primary" disabled={key.trim().length < 10 || checking} onClick={saveKey}>
                    {checking ? <LoaderCircle className="spin" /> : <ShieldCheck />}
                    Test and save
                  </button>
                </div>
                <span className="desc">
                  Get one free at{" "}
                  <a href="#" onClick={(e) => (e.preventDefault(), api.openExternal("https://aistudio.google.com/apikey"))}>
                    aistudio.google.com <ExternalLink size={11} style={{ verticalAlign: -1 }} />
                  </a>
                  . It is checked with Google before it is stored.
                </span>
              </div>
              <Toggle label="Use Gemini to review findings" locked={locks.aiEnabled} checked={settings.aiEnabled} onChange={(v) => saveSettings({ aiEnabled: v })} desc="Gemini can veto a removal but can never approve one on its own." />
              <Toggle label="Send short masked text previews" locked={locks.previews} checked={settings.previews} onChange={(v) => saveSettings({ previews: v })} desc="First lines of small text files, with secrets, tokens and emails masked." />
              <div className="toggle">
                <span className="label">
                  Items per scan
                  {locks.maxAi && <ShieldCheck className="lock" />}
                </span>
                <select className="input" style={{ gridRow: "1 / span 2", gridColumn: 2, width: 96 }} value={settings.maxAi} disabled={locks.maxAi} onChange={(e) => saveSettings({ maxAi: Number(e.target.value) })}>
                  {[100, 200, 400, 800].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
                <span className="desc">The biggest candidates go first. 400 fits the free tier comfortably.</span>
              </div>
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <h2>Never scan</h2>
              <span className="sub">{settings.exclude.length} folders</span>
            </div>
            <div className="card-body">
              <div className="targets">
                {settings.exclude.map((p) => (
                  <div className="target" key={p}>
                    <FolderOpen style={{ color: "var(--text-3)" }} />
                    <span className="p mono truncate">{shortPath(p)}</span>
                    <button type="button" className="btn sm ghost icon" aria-label={`Stop excluding ${p}`} onClick={() => saveSettings({ exclude: settings.exclude.filter((x) => x !== p) })}>
                      <X />
                    </button>
                  </div>
                ))}
                {policy.excludePaths.map((p) => (
                  <div className="target" key={`policy-${p}`} title="Set by your organization">
                    <Building2 style={{ color: "var(--blue)" }} />
                    <span className="p mono truncate">{p}</span>
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="chip"
                onClick={async () => {
                  const picked = await api.pickFolders();
                  if (picked.length) saveSettings({ exclude: [...new Set([...settings.exclude, ...picked])] });
                }}
              >
                <FolderPlus />
                Add folder
              </button>
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <h2>Appearance</h2>
            </div>
            <div className="card-body">
              <Segmented<Theme>
                label="Theme"
                value={settings.theme}
                onChange={(theme) => saveSettings({ theme })}
                options={[
                  { value: "system", label: "System", icon: <Monitor /> },
                  { value: "dark", label: "Dark", icon: <Moon /> },
                  { value: "light", label: "Light", icon: <Sun /> },
                ]}
              />
            </div>
          </section>
        </div>

        <div className="stack">
          <section className="card">
            <div className="card-head">
              <h2>Organization policy</h2>
              <span className={`badge ${policy.managed ? "blue" : ""}`} style={{ marginLeft: "auto" }}>
                {policy.managed ? `Managed${policy.organization ? ` by ${policy.organization}` : ""}` : "Not managed"}
              </span>
            </div>
            <div className="card-body" style={{ display: "grid", gap: 12 }}>
              {policy.error && (
                <div className="keybox" style={{ borderColor: "var(--amber-line)" }}>
                  <TriangleAlert style={{ color: "var(--amber)" }} />
                  <span>{policy.error}. The strictest settings apply until IT fixes the file.</span>
                </div>
              )}
              {policy.managed ? (
                <dl className="kv">
                  {policyRows.map(([k, v]) => (
                    <span key={k} style={{ display: "contents" }}>
                      <dt>{k}</dt>
                      <dd>{v}</dd>
                    </span>
                  ))}
                </dl>
              ) : (
                <p className="muted" style={{ margin: 0 }}>
                  IT can lock these settings for every user by deploying a policy file to <span className="mono">{policy.source}</span>, for example with Intune or Group Policy. It applies to this app and the command line alike.
                </p>
              )}
              <pre className="code">{POLICY_EXAMPLE}</pre>
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <h2>Data and privacy</h2>
            </div>
            <div className="card-body" style={{ display: "grid", gap: 12 }}>
              <dl className="kv">
                <dt>Data folder</dt>
                <dd className="mono" title={info.dataDir}>{shortPath(info.dataDir)}</dd>
                <dt>Activity log</dt>
                <dd className="mono" title={info.auditFile}>{shortPath(info.auditFile)}</dd>
                <dt>Diagnostics</dt>
                <dd className="mono" title={info.logFile}>{shortPath(info.logFile)}</dd>
                <dt>Sent to Google</dt>
                <dd style={{ whiteSpace: "normal" }}>
                  {settings.aiEnabled ? `Paths, sizes, dates and file types${settings.previews ? ", masked previews" : ""}. The space map sends folder names and sizes only.` : "Nothing. Gemini is off."}
                </dd>
              </dl>
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" className="btn sm" onClick={() => api.openPath("data")}>
                  <FolderOpen />
                  Open data folder
                </button>
                <button type="button" className="btn sm ghost" onClick={() => api.openPath("logs")}>
                  Open logs
                </button>
              </div>
            </div>
          </section>

          <UpdatesCard autoUpdate={settings.autoUpdate} />

          <section className="card">
            <div className="card-head">
              <h2>About</h2>
            </div>
            <div className="card-body">
              <dl className="kv">
                <dt>Cleaner</dt>
                <dd>{info.version}</dd>
                <dt>Engine</dt>
                <dd>{info.engineVersion}, shared with the command line</dd>
                <dt>Runtime</dt>
                <dd>Electron {info.electron}</dd>
                <dt>Signed in as</dt>
                <dd className="mono">
                  {info.user}@{info.machine}
                </dd>
                <dt>License</dt>
                <dd>
                  MIT ·{" "}
                  <a href="#" onClick={(e) => (e.preventDefault(), api.openExternal("https://github.com/WOOLMO/Cleaner"))}>
                    github.com/WOOLMO/Cleaner
                  </a>
                </dd>
              </dl>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function updateLine(u: UpdateState): string {
  const when = u.checkedAt ? new Date(u.checkedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : null;
  switch (u.status) {
    case "checking":
      return "Checking GitHub for a new version...";
    case "downloading":
      return `Downloading ${u.version}${u.percent ? `, ${u.percent}%` : ""}. You can keep working.`;
    case "ready":
      return `Version ${u.version} is downloaded. It installs when you close Cleaner.`;
    case "available":
      return `Version ${u.version} is out. This copy runs from a zip, so download the new one from GitHub.`;
    case "error":
      return `The last check failed: ${u.error ?? "unknown error"}`;
    case "current":
      return `You have the latest version${when ? `, checked ${when}` : ""}.`;
    default:
      return u.enabled ? "Not checked yet." : "Updates are off when Cleaner runs from source.";
  }
}

function UpdatesCard({ autoUpdate }: { autoUpdate: boolean }) {
  const u = useStore((s) => s.update);
  if (!u) return null;
  const busy = u.status === "checking" || u.status === "downloading";
  return (
    <section className="card">
      <div className="card-head">
        <h2>Updates</h2>
        <span className={`badge ${u.status === "ready" || u.status === "available" ? "green" : ""}`} style={{ marginLeft: "auto" }}>
          {u.status === "ready" || u.status === "available" ? `${u.version} available` : u.current}
        </span>
      </div>
      <div className="card-body" style={{ display: "grid", gap: 12 }}>
        <div className="keybox">
          {u.status === "error" ? <TriangleAlert style={{ color: "var(--amber)" }} /> : busy ? <LoaderCircle className="spin" /> : u.status === "ready" || u.status === "available" ? <Download style={{ color: "var(--accent)" }} /> : <CircleCheck style={{ color: "var(--accent)" }} />}
          <span style={{ flex: 1, minWidth: 0 }}>{updateLine(u)}</span>
        </div>
        {u.status === "downloading" && u.percent !== null && (
          <div className="update-bar" role="progressbar" aria-valuenow={u.percent} aria-valuemin={0} aria-valuemax={100}>
            <i style={{ width: `${u.percent}%` }} />
          </div>
        )}
        <Toggle label="Check for updates automatically" checked={autoUpdate} onChange={(v) => saveSettings({ autoUpdate: v })} desc="Every few hours, from the project's GitHub releases. The download is checked against its published SHA-512 before it runs." />
        <div style={{ display: "flex", gap: 8 }}>
          {u.status === "ready" ? (
            <button type="button" className="btn sm primary" onClick={installUpdate}>
              <RotateCcw />
              Restart and update
            </button>
          ) : u.status === "available" ? (
            <button type="button" className="btn sm primary" onClick={() => api.openExternal(u.releases)}>
              <Download />
              Download {u.version}
            </button>
          ) : (
            <button type="button" className="btn sm" disabled={!u.enabled || busy} onClick={checkUpdate}>
              <RefreshCw className={u.status === "checking" ? "spin" : undefined} />
              Check now
            </button>
          )}
          <button type="button" className="btn sm ghost" onClick={() => api.openExternal(u.releases)}>
            Release notes
          </button>
        </div>
      </div>
    </section>
  );
}
