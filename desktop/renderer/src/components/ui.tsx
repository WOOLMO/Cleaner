import { useEffect, useRef, type ReactNode } from "react";
import { Check as CheckIcon, CircleCheck, Info, Lock, Minus, TriangleAlert, X } from "lucide-react";
import { dismissToast, useStore } from "../store";

// The Cleaner mark: a disk gauge whose needle points into the green.
export function BrandMark({ size = 22 }: { size?: number }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="bm-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1b2a21" />
          <stop offset="1" stopColor="#0c130f" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#bm-bg)" />
      <rect x="0.5" y="0.5" width="31" height="31" rx="8.5" fill="none" stroke="rgba(214,255,228,.14)" />
      <path d="M8.4 21.6a8.6 8.6 0 1 1 15.2 0" fill="none" stroke="#2c3a31" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M17.6 7.55a8.6 8.6 0 0 1 6 14.05" fill="none" stroke="#4fe08f" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M16 17.2 21 11.8" stroke="#e8eee9" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="16" cy="17.4" r="2.1" fill="#e8eee9" />
    </svg>
  );
}

export function PageHead({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}

export function Toggle(props: {
  label: string;
  desc?: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  locked?: boolean;
}) {
  const { label, desc, checked, onChange, locked } = props;
  return (
    <div className="toggle">
      <span className="label">
        {label}
        {locked && <Lock className="lock" aria-label="Set by your organization" />}
      </span>
      <button
        type="button"
        className="switch"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={locked}
        title={locked ? "Set by your organization" : undefined}
        onClick={() => onChange(!checked)}
      />
      {desc && <span className="desc">{desc}</span>}
    </div>
  );
}

export function Segmented<T extends string>(props: {
  value: T;
  options: { value: T; label: ReactNode; count?: number; icon?: ReactNode }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={props.label}>
      {props.options.map((o) => (
        <button key={o.value} type="button" aria-pressed={props.value === o.value} onClick={() => props.onChange(o.value)}>
          {o.icon}
          {o.label}
          {o.count !== undefined && <span className="n">{o.count.toLocaleString()}</span>}
        </button>
      ))}
    </div>
  );
}

export function Empty({ icon, title, body, action }: { icon: ReactNode; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div>
        <div className="glyph" style={{ margin: "0 auto 14px" }}>{icon}</div>
        <h3>{title}</h3>
        {body && <p style={{ margin: "0 auto 16px" }}>{body}</p>}
        {action}
      </div>
    </div>
  );
}

export function Checkbox({ state, onChange, label, disabled }: { state: boolean | "mixed"; onChange: () => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      className="check"
      role="checkbox"
      aria-checked={state}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
    >
      {state === "mixed" ? <Minus strokeWidth={3} /> : state ? <CheckIcon strokeWidth={3} /> : null}
    </button>
  );
}

// Modal dialog: Escape closes it, focus starts on the safe choice.
export function Dialog(props: {
  open: boolean;
  onClose: () => void;
  tone?: "danger" | "accent" | "neutral";
  icon: ReactNode;
  title: string;
  body?: ReactNode;
  children?: ReactNode;
  footer: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!props.open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [props.open]);
  if (!props.open) return null;
  const toneBg = props.tone === "danger" ? "var(--red-soft)" : props.tone === "accent" ? "var(--accent-soft)" : "var(--surface-3)";
  const toneFg = props.tone === "danger" ? "var(--red)" : props.tone === "accent" ? "var(--accent)" : "var(--text-2)";
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="dialog" role="alertdialog" aria-modal="true" aria-label={props.title} ref={ref}>
        <header>
          <div className="dialog-icon" style={{ background: toneBg, color: toneFg }}>{props.icon}</div>
          <div>
            <h3>{props.title}</h3>
            {props.body && <p>{props.body}</p>}
          </div>
        </header>
        {props.children && <div className="dialog-body">{props.children}</div>}
        <footer>{props.footer}</footer>
      </div>
    </div>
  );
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.tone}`}>
          {t.tone === "ok" ? <CircleCheck /> : t.tone === "info" ? <Info /> : <TriangleAlert />}
          <div>
            <b>{t.title}</b>
            {t.body && <span>{t.body}</span>}
          </div>
          <button type="button" aria-label="Dismiss" onClick={() => dismissToast(t.id)}>
            <X size={15} />
          </button>
        </div>
      ))}
    </div>
  );
}

// Drive gauge: free space as the track, used space in grey, and the part a cleanup can win back in green.
export function Ring({ total, used, reclaim, children }: { total: number; used: number; reclaim: number; children: ReactNode }) {
  const r = 94;
  const c = 2 * Math.PI * r;
  const usedFrac = total ? Math.min(1, used / total) : 0;
  const reclaimFrac = total ? Math.min(usedFrac, reclaim / total) : 0;
  return (
    <div className="ring">
      <svg viewBox="0 0 220 220" aria-hidden="true">
        <circle cx="110" cy="110" r={r} stroke="var(--surface-3)" strokeWidth="16" />
        <circle cx="110" cy="110" r={r} stroke="var(--text-3)" strokeOpacity="0.55" strokeWidth="16" strokeLinecap="butt" strokeDasharray={`${c * usedFrac} ${c}`} />
        <circle
          cx="110"
          cy="110"
          r={r}
          stroke="var(--accent)"
          strokeWidth="16"
          strokeLinecap="butt"
          strokeDasharray={`${c * reclaimFrac} ${c}`}
          strokeDashoffset={-c * (usedFrac - reclaimFrac)}
          style={{ filter: "drop-shadow(0 0 8px var(--accent-line))" }}
        />
      </svg>
      <div className="center">{children}</div>
    </div>
  );
}
