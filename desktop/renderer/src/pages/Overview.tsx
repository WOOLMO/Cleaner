import { Archive, ArrowUpRight, Clock, HardDrive, LayoutGrid, Play, ShieldCheck, Sparkles } from "lucide-react";
import { go, startMap, startScan, useStore } from "../store";
import { Empty, PageHead, Ring } from "../components/ui";
import { ActionIcon, describe } from "../components/activity";
import { displayRoot, duration, formatCount, formatSize, shortPath, sizeParts, timeAgo } from "../format";

const sum = (list: { size: number }[]) => list.reduce((s, e) => s + e.size, 0);

export function Overview() {
  const info = useStore((s) => s.info);
  const drives = useStore((s) => s.drives);
  const scan = useStore((s) => s.scan);
  const held = useStore((s) => s.held);
  const map = useStore((s) => s.map);
  const activity = useStore((s) => s.activity);
  const settings = useStore((s) => s.settings);
  const threat = useStore((s) => s.protect.scan);
  if (!info) return null;

  const drive = drives.find((d) => d.letter === "C") ?? drives[0];
  const pending = scan?.entries.filter((e) => e.status === "pending") ?? [];
  const safe = pending.filter((e) => e.verdict === "remove");
  const yours = pending.filter((e) => e.verdict === "review");
  const reclaim = sum(safe);
  const used = drive ? drive.total - drive.free : 0;
  const [freeValue, freeUnit] = sizeParts(drive?.free ?? 0);
  const [reclaimValue, reclaimUnit] = sizeParts(reclaim);
  const aiOn = Boolean(settings?.settings.aiEnabled && settings.key.hasKey);
  const topUnits = map?.units.slice(0, 6) ?? [];

  return (
    <div className="page">
      <PageHead
        title="Overview"
        sub="How your drives are doing and what can be won back."
        actions={
          <>
            {drive && (
              <button type="button" className="btn" onClick={() => startMap(drive.root)}>
                <LayoutGrid />
                Map drive {drive.letter}:
              </button>
            )}
            <button type="button" className="btn primary" onClick={() => startScan([info.home])}>
              <Play />
              Scan my user folder
            </button>
          </>
        }
      />

      <div className="ov-grid">
        {drive && (
          <section className="card ov-drive" aria-label={`Drive ${drive.letter}`}>
            <Ring total={drive.total} used={used} reclaim={reclaim}>
              <div className="big">
                {freeValue}
                <small>{freeUnit}</small>
              </div>
              <div className="cap">free on {drive.letter}:</div>
            </Ring>
            <div className="legend">
              <div className="drive-title">
                <HardDrive size={18} className="muted" />
                <h2>Drive {drive.letter}:</h2>
                <span className={`badge ${used / drive.total > 0.9 ? "red" : ""}`}>{Math.round((used / drive.total) * 100)}% used</span>
              </div>
              <div className="row">
                <span className="sw" style={{ background: "var(--text-3)", opacity: 0.55 }} />
                <span>Used</span>
                <b>{formatSize(used)}</b>
              </div>
              <div className="row">
                <span className="sw" style={{ background: "var(--accent)" }} />
                <span>Safe to reclaim</span>
                <b style={{ color: "var(--accent)" }}>{formatSize(reclaim)}</b>
              </div>
              <div className="row">
                <span className="sw" style={{ background: "var(--surface-3)" }} />
                <span>Free</span>
                <b>{formatSize(drive.free)}</b>
              </div>
              <div className="row">
                <span />
                <span className="muted">After cleanup</span>
                <b className="muted">{formatSize(drive.free + reclaim)} free</b>
              </div>
            </div>
          </section>
        )}

        <section className="card reclaim-hero">
          <div className="muted">Ready to reclaim</div>
          <div className="big">
            {reclaimValue}
            <small>{reclaimUnit}</small>
          </div>
          <div className="split">
            <div>
              <div className="k">Safe to remove</div>
              <div className="v" style={{ color: "var(--accent)" }}>{formatSize(reclaim)}</div>
              <div className="faint">{formatCount(safe.length)} items</div>
            </div>
            <div>
              <div className="k">Your call</div>
              <div className="v" style={{ color: "var(--amber)" }}>{formatSize(sum(yours))}</div>
              <div className="faint">{formatCount(yours.length)} items</div>
            </div>
          </div>
          {scan ? (
            <button type="button" className="btn primary" onClick={() => go("scan")}>
              Review findings
              <ArrowUpRight />
            </button>
          ) : (
            <button type="button" className="btn primary" onClick={() => startScan([info.home])}>
              <Play />
              Run your first scan
            </button>
          )}
          <div className="faint">{scan ? `From the scan of ${scan.roots.map(displayRoot).join(", ")}, ${timeAgo(scan.finishedAt)}.` : "Scans are read-only. Nothing is removed until you say so."}</div>
        </section>
      </div>

      <div className="ov-row">
        <div className="tile">
          <span className="k">
            <Clock size={14} />
            Last scan
          </span>
          <span className="v" style={{ fontSize: 22 }}>{scan ? timeAgo(scan.finishedAt) : "Never"}</span>
          <span className="d">{scan ? `${formatCount(scan.stats.files)} files in ${duration(scan.durationMs)}` : "Start one from the Scan page"}</span>
        </div>
        <button type="button" className="tile" onClick={() => go("holding")}>
          <span className="k">
            <Archive size={14} />
            Holding area
          </span>
          <span className="v" style={{ fontSize: 22 }}>{formatSize(sum(held))}</span>
          <span className="d">{held.length ? `${held.length} items, freed when you purge` : "Empty. Held items can be put back."}</span>
        </button>
        <button type="button" className="tile" onClick={() => go("protect")}>
          <span className="k">
            <ShieldCheck size={14} />
            Protection
          </span>
          <span className="v" style={{ fontSize: 22, color: !threat ? "var(--text-2)" : threat.stats.threats ? "var(--red)" : threat.stats.suspicious ? "var(--amber)" : "var(--accent)" }}>
            {!threat ? "Not scanned" : threat.stats.threats ? `${threat.stats.threats} threats` : threat.stats.suspicious ? `${threat.stats.suspicious} to check` : "No threats"}
          </span>
          <span className="d">{threat ? `Threat scan ${timeAgo(threat.finishedAt)}, ${formatCount(threat.stats.inspected)} files` : "Run a one-minute quick scan"}</span>
        </button>
        <button type="button" className="tile" onClick={() => go("settings")}>
          <span className="k">
            <Sparkles size={14} />
            Gemini review
          </span>
          <span className="v" style={{ fontSize: 22, color: aiOn ? "var(--accent)" : "var(--text-2)" }}>{aiOn ? "On" : "Off"}</span>
          <span className="d">
            {settings?.locks.aiEnabled ? "Turned off by your organization" : aiOn ? scan?.model && scan.model !== "local rules" ? scan.model : "Double-checks every finding" : "Add a free key in Settings"}
          </span>
        </button>
      </div>

      <div className="ov-lower">
        <section className="card">
          <div className="card-head">
            <h2>Biggest folders</h2>
            {map && <span className="sub">{map.root}, {timeAgo(map.finishedAt)}</span>}
            <div className="right">
              <button type="button" className="btn sm ghost" onClick={() => go("map")}>
                Open map
                <ArrowUpRight />
              </button>
            </div>
          </div>
          <div className="card-body">
            {topUnits.length ? (
              <ul className="list">
                {topUnits.map((u) => {
                  const ex = map?.explained[u.path];
                  return (
                    <li key={u.path}>
                      <div className="truncate">
                        <div className="t truncate">{ex?.label ?? shortPath(u.path)}</div>
                        <div className="s mono truncate">{shortPath(u.path)}</div>
                      </div>
                      <b className="mono">{formatSize(u.size)}</b>
                      <div className="meter thin">
                        <i style={{ width: `${(u.size / topUnits[0].size) * 100}%`, background: ex?.advice === "reclaim" ? "var(--accent)" : ex?.advice === "check" ? "var(--amber)" : "var(--text-3)" }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <Empty
                icon={<LayoutGrid size={22} />}
                title="See where your space goes"
                body="The space map sizes every folder on the drive and explains the biggest ones."
                action={
                  drive && (
                    <button type="button" className="btn" onClick={() => startMap(drive.root)}>
                      Map drive {drive.letter}:
                    </button>
                  )
                }
              />
            )}
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Recent activity</h2>
            <div className="right">
              <button type="button" className="btn sm ghost" onClick={() => go("activity")}>
                View all
                <ArrowUpRight />
              </button>
            </div>
          </div>
          <div className="card-body">
            {activity.length ? (
              <ul className="list">
                {activity.slice(0, 6).map((a, i) => (
                  <li key={`${a.time}-${i}`} style={{ gridTemplateColumns: "auto minmax(0,1fr) auto" }}>
                    <ActionIcon action={a.action} />
                    <div className="truncate">
                      <div className="t truncate">{describe(a)}</div>
                      <div className="s">
                        {timeAgo(a.time)} · {a.app === "cli" ? "command line" : "desktop app"}
                      </div>
                    </div>
                    {a.bytes ? <span className="mono muted">{formatSize(a.bytes)}</span> : <span />}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted" style={{ margin: 0 }}>
                Every scan, hold, delete and restore is recorded here.
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
