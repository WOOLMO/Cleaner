import { useEffect, useMemo, useRef, useState } from "react";
import { stratify, tree, type HierarchyPointNode } from "d3-hierarchy";
import { Maximize, Minus, Plus } from "lucide-react";
import type { FolderNetwork, NetNode } from "../types";
import { formatSize } from "../format";

// The full folder network: thousands of folders laid out as a radial tree, each top-level branch in its
// own color, revealed in a wave from the root. Geometry is cached in Path2D objects per branch, so a
// redraw of 5,000 folders is a handful of canvas calls; frames are only drawn when something changes.

interface Placed {
  n: NetNode;
  x: number;
  y: number;
  angle: number;
  radius: number;
  r: number;
  branch: number;
  parent: number;
  delay: number;
}

const RING = 160;
const REVEAL_MS = 2200;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const offscreen = () => document.visibilityState === "hidden" || Boolean(window.cleanerWindow?.capture);

function branchColor(i: number, dark: boolean, alpha = 1) {
  const hue = (i * 137.508 + 148) % 360;
  return `hsla(${hue.toFixed(1)}, ${dark ? 72 : 62}%, ${dark ? 64 : 44}%, ${alpha})`;
}

export function layoutNetwork(net: FolderNetwork): { placed: Placed[]; maxR: number } {
  const root = stratify<NetNode>()
    .id((d) => String(d.id))
    .parentId((d) => (d.parent < 0 ? null : String(d.parent)))(net.nodes);
  root.sort((a, b) => b.data.size - a.data.size);
  const depth = Math.max(1, root.height);
  const laid = tree<NetNode>()
    .size([2 * Math.PI, depth * RING])
    .separation((a, b) => (a.parent === b.parent ? 1 : 1.6) / Math.max(1, a.depth))(root);
  const maxSize = Math.max(1, ...net.nodes.filter((n) => n.parent === 0).map((n) => n.size));
  const placed: Placed[] = new Array(net.nodes.length);
  const top = laid.children ?? [];
  const branchOf = new Map<HierarchyPointNode<NetNode>, number>();
  top.forEach((c, i) => branchOf.set(c, i));
  laid.each((node) => {
    let b = -1;
    let p: HierarchyPointNode<NetNode> | null = node;
    while (p && p.depth > 1) p = p.parent;
    if (p && p.depth === 1) b = branchOf.get(p) ?? -1;
    const angle = node.x - Math.PI / 2;
    const radius = node.y;
    const share = Math.sqrt(node.data.size / maxSize);
    placed[node.data.id] = {
      n: node.data,
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      angle: node.x,
      radius,
      r: node.depth === 0 ? 22 : node.data.more ? 3.5 : clamp(1.6 + share * 18 / Math.sqrt(node.depth), 1.6, 20),
      branch: b,
      parent: node.data.parent,
      // the reveal travels outward by depth and sweeps around the circle
      delay: node.depth * 260 + (node.x / (2 * Math.PI)) * 320,
    };
  });
  return { placed, maxR: depth * RING };
}

export function NetworkView(props: {
  network: FolderNetwork;
  selected: number | null;
  query: string;
  onSelect: (id: number | null) => void;
  onOpen?: (id: number) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const view = useRef({ x: 0, y: 0, k: 1, w: 0, h: 0 });
  const anim = useRef<{ from: { x: number; y: number; k: number }; to: { x: number; y: number; k: number }; start: number } | null>(null);
  const hoverRef = useRef<number | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const startRef = useRef(0);
  const dirty = useRef(true);
  const [tip, setTip] = useState<{ id: number; x: number; y: number } | null>(null);

  const { placed, maxR } = useMemo(() => layoutNetwork(props.network), [props.network]);
  const children = useMemo(() => {
    const map = new Map<number, number[]>();
    for (const p of placed) if (p && p.parent >= 0) (map.get(p.parent) ?? map.set(p.parent, []).get(p.parent)!).push(p.n.id);
    return map;
  }, [placed]);
  // spatial grid for hit testing thousands of nodes
  const grid = useMemo(() => {
    const cell = 48;
    const g = new Map<string, number[]>();
    for (const p of placed) {
      if (!p) continue;
      const key = `${Math.floor(p.x / cell)},${Math.floor(p.y / cell)}`;
      (g.get(key) ?? g.set(key, []).get(key)!).push(p.n.id);
    }
    return { cell, g };
  }, [placed]);

  // Cached geometry per branch: links and nodes, in graph coordinates.
  const paths = useMemo(() => {
    const links = new Map<number, Path2D>();
    const dots = new Map<number, Path2D>();
    for (const p of placed) {
      if (!p || p.parent < 0) continue;
      const q = placed[p.parent];
      const l = links.get(p.branch) ?? links.set(p.branch, new Path2D()).get(p.branch)!;
      curve(l, q, p);
      if (!p.n.more) {
        const d = dots.get(p.branch) ?? dots.set(p.branch, new Path2D()).get(p.branch)!;
        d.moveTo(p.x + p.r, p.y);
        d.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      }
    }
    return { links, dots };
  }, [placed]);

  useEffect(() => {
    startRef.current = offscreen() ? -1e9 : performance.now();
    anim.current = null;
    fit(false);
    dirty.current = true;
  }, [placed]);
  useEffect(() => {
    dirty.current = true;
  }, [props.selected, props.query]);

  function fit(animate: boolean) {
    const v = view.current;
    if (!v.w) return;
    const k = clamp(Math.min(v.w, v.h - 70) / (2 * maxR + 120), 0.05, 2);
    const to = { k, x: v.w / 2, y: (v.h - 50) / 2 + 10 };
    if (!animate || offscreen()) Object.assign(v, to);
    else anim.current = { from: { x: v.x, y: v.y, k: v.k }, to, start: performance.now() };
    dirty.current = true;
  }
  function zoomBy(f: number, cx = view.current.w / 2, cy = view.current.h / 2) {
    const v = view.current;
    const k = clamp(v.k * f, 0.04, 8);
    anim.current = { from: { x: v.x, y: v.y, k: v.k }, to: { k, x: cx - ((cx - v.x) * k) / v.k, y: cy - ((cy - v.y) * k) / v.k }, start: performance.now() };
  }
  function hit(sx: number, sy: number): number | null {
    const v = view.current;
    const gx = (sx - v.x) / v.k;
    const gy = (sy - v.y) / v.k;
    const { cell, g } = grid;
    const cx = Math.floor(gx / cell);
    const cy = Math.floor(gy / cell);
    let best: number | null = null;
    let bestD = Infinity;
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        for (const id of g.get(`${cx + i},${cy + j}`) ?? []) {
          const p = placed[id];
          const d = Math.hypot(p.x - gx, p.y - gy);
          if (d <= Math.max(p.r, 3 / v.k) + 3 / v.k && d < bestD) {
            best = id;
            bestD = d;
          }
        }
      }
    }
    return best;
  }

  useEffect(() => {
    const canvas = canvasRef.current!;
    const wrap = wrapRef.current!;
    const ctx = canvas.getContext("2d")!;
    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const first = !view.current.w;
      view.current.w = rect.width;
      view.current.h = rect.height;
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      if (first) fit(false);
      dirty.current = true;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    const theme = new MutationObserver(() => (dirty.current = true));
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    let raf = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const frame = () => {
      const now = performance.now();
      const revealing = now - startRef.current < REVEAL_MS + 2600;
      const lit = hoverRef.current !== null || propsRef.current.selected !== null;
      if (dirty.current || revealing || anim.current || lit) {
        dirty.current = false;
        draw(ctx, now);
      }
      if (offscreen()) timer = setTimeout(frame, 50);
      else raf = requestAnimationFrame(frame);
    };
    frame();
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      ro.disconnect();
      theme.disconnect();
    };
  }, [placed]);

  function draw(ctx: CanvasRenderingContext2D, now: number) {
    const css = getComputedStyle(document.documentElement);
    const dark = document.documentElement.dataset.theme !== "light";
    const color = (name: string) => css.getPropertyValue(name).trim();
    const v = view.current;
    const dpr = window.devicePixelRatio || 1;
    if (anim.current) {
      const a = anim.current;
      const t = clamp((now - a.start) / 600, 0, 1);
      const e = easeInOut(t);
      v.k = a.from.k + (a.to.k - a.from.k) * e;
      v.x = a.from.x + (a.to.x - a.from.x) * e;
      v.y = a.from.y + (a.to.y - a.from.y) * e;
      if (t >= 1) anim.current = null;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, v.w, v.h);
    ctx.setTransform(dpr * v.k, 0, 0, dpr * v.k, dpr * v.x, dpr * v.y);
    const k = v.k;
    const elapsed = now - startRef.current;
    const revealing = elapsed < REVEAL_MS + 900;

    // depth rings, faint
    ctx.lineWidth = 1 / k;
    ctx.strokeStyle = color("--line");
    for (let r = RING; r <= maxR; r += RING) {
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.stroke();
    }

    const { selected, query } = propsRef.current;
    const focus = hoverRef.current ?? selected;
    const q = query.trim().toLowerCase();
    const matches = q.length >= 2 ? placed.filter((p) => p && p.n.name.toLowerCase().includes(q)) : [];
    const lit = new Set<number>();
    if (focus !== null) {
      for (let id: number = focus; id >= 0; id = placed[id].parent) lit.add(id);
      const stack = [...(children.get(focus) ?? [])];
      while (stack.length) {
        const id = stack.pop()!;
        lit.add(id);
        stack.push(...(children.get(id) ?? []));
      }
    }
    for (const m of matches) for (let id: number = m.n.id; id >= 0; id = placed[id].parent) lit.add(id);
    const dim = lit.size > 0;

    if (revealing) {
      // during the reveal every link and node grows out of its parent
      for (const p of placed) {
        if (!p || p.parent < 0) continue;
        const t = clamp((elapsed - p.delay) / 520, 0, 1);
        if (t <= 0) continue;
        const e = easeOut(t);
        const q0 = placed[p.parent];
        const tx = q0.x + (p.x - q0.x) * e;
        const ty = q0.y + (p.y - q0.y) * e;
        ctx.globalAlpha = 0.55 * e;
        ctx.strokeStyle = branchColor(p.branch, dark);
        ctx.lineWidth = Math.max(0.6, 1.2 - p.n.depth * 0.12) / Math.max(0.35, k);
        ctx.beginPath();
        ctx.moveTo(q0.x, q0.y);
        ctx.lineTo(tx, ty);
        ctx.stroke();
        ctx.globalAlpha = e;
        ctx.fillStyle = branchColor(p.branch, dark);
        ctx.beginPath();
        ctx.arc(tx, ty, p.n.more ? p.r * 0.6 : p.r * e, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      for (const [b, path] of paths.links) {
        ctx.globalAlpha = dim ? 0.08 : 0.42;
        ctx.strokeStyle = branchColor(b, dark);
        ctx.lineWidth = 0.9 / Math.max(0.35, k);
        ctx.stroke(path);
      }
      for (const [b, path] of paths.dots) {
        ctx.globalAlpha = dim ? 0.16 : 0.95;
        ctx.fillStyle = branchColor(b, dark);
        ctx.fill(path);
      }
      // folded "+N folders" nodes as hollow rings
      ctx.globalAlpha = dim ? 0.15 : 0.6;
      ctx.lineWidth = 1 / k;
      ctx.strokeStyle = color("--text-3");
      ctx.beginPath();
      for (const p of placed) {
        if (!p?.n.more) continue;
        ctx.moveTo(p.x + p.r, p.y);
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      }
      ctx.stroke();

      // the lit part: a path to the root, a subtree, search matches
      if (dim) {
        ctx.globalAlpha = 1;
        for (const id of lit) {
          const p = placed[id];
          if (p.parent < 0) continue;
          const onPath = focus !== null && isAncestorOrSelf(id, focus);
          ctx.strokeStyle = onPath ? color("--accent") : branchColor(p.branch, dark);
          ctx.lineWidth = (onPath ? 2.2 : 1.1) / Math.max(0.35, k);
          const l = new Path2D();
          curve(l, placed[p.parent], p);
          ctx.stroke(l);
        }
        for (const id of lit) {
          const p = placed[id];
          if (p.parent < 0) continue;
          ctx.fillStyle = branchColor(p.branch, dark);
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.fill();
        }
        // a pulse travelling from the root to the focused folder
        if (focus !== null && focus > 0) {
          const chain: Placed[] = [];
          for (let id: number = focus; id >= 0; id = placed[id].parent) chain.unshift(placed[id]);
          const t = ((now / 1400) % 1) * (chain.length - 1);
          const i = Math.floor(t);
          const a = chain[i];
          const b = chain[Math.min(chain.length - 1, i + 1)];
          const f = t - i;
          ctx.fillStyle = color("--accent");
          ctx.shadowColor = color("--accent");
          ctx.shadowBlur = 12;
          ctx.beginPath();
          ctx.arc(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f, 4 / Math.max(0.5, k), 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
        }
      }
    }

    // the root
    ctx.globalAlpha = 1;
    const breathe = 1 + Math.sin(now / 800) * 0.06;
    ctx.fillStyle = color("--accent");
    ctx.globalAlpha = 0.16;
    ctx.beginPath();
    ctx.arc(0, 0, 34 * breathe, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(0, 0, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = color("--bg");
    ctx.beginPath();
    ctx.arc(0, 0, 7, 0, Math.PI * 2);
    ctx.fill();

    // selection ring
    if (selected !== null && placed[selected]) {
      const p = placed[selected];
      ctx.strokeStyle = color("--accent");
      ctx.lineWidth = 2 / k;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r + 5 / k, 0, Math.PI * 2);
      ctx.stroke();
    }

    // labels in screen space, claimed in priority order so they never overlap
    if (!revealing || elapsed > REVEAL_MS * 0.6) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.lineJoin = "round";
      const font = color("--font");
      const want: { p: Placed; prio: number; strong: boolean }[] = [];
      for (const p of placed) {
        if (!p) continue;
        const sx = v.x + p.x * k;
        const sy = v.y + p.y * k;
        if (sx < -60 || sy < -20 || sx > v.w + 60 || sy > v.h + 20) continue;
        const strong = p.n.id === focus || p.n.id === selected || (matches.length > 0 && matches.includes(p));
        if (!strong && dim && !lit.has(p.n.id)) continue;
        const big = p.r * k;
        if (!strong && p.n.depth > 1 && big < 4.5) continue;
        want.push({ p, strong, prio: p.n.depth === 0 ? -1 : strong ? 0 : p.n.depth * 10 - big });
      }
      want.sort((a, b) => a.prio - b.prio);
      const placedBoxes: number[][] = [];
      let drawn = 0;
      for (const { p, strong } of want) {
        if (drawn > 180) break;
        const size = p.n.depth === 0 ? 13 : p.n.depth === 1 ? 12 : 11;
        ctx.font = `${p.n.depth <= 1 || strong ? 600 : 450} ${size}px ${font}`;
        const text = p.n.depth === 0 ? p.n.name : p.n.name.length > 22 ? p.n.name.slice(0, 21) + "…" : p.n.name;
        const sx = v.x + p.x * k;
        const sy = v.y + p.y * k + Math.max(p.r * k, 2) + 4;
        const half = ctx.measureText(text).width / 2 + 3;
        const box = [sx - half, sy - 1, sx + half, sy + size + 2];
        if (placedBoxes.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
        placedBoxes.push(box);
        drawn++;
        ctx.globalAlpha = 1;
        ctx.strokeStyle = color("--bg");
        ctx.lineWidth = 3.5;
        ctx.strokeText(text, sx, sy);
        ctx.fillStyle = strong ? color("--text") : p.n.depth <= 1 ? color("--text-2") : color("--text-3");
        ctx.fillText(text, sx, sy);
      }
    }
    ctx.globalAlpha = 1;
  }

  function isAncestorOrSelf(id: number, of: number) {
    for (let x: number = of; x >= 0; x = placed[x].parent) if (x === id) return true;
    return false;
  }

  const drag = useRef<{ sx: number; sy: number; vx: number; vy: number; moved: boolean } | null>(null);
  const local = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { sx: e.clientX - r.left, sy: e.clientY - r.top };
  };
  const tipNode = tip ? placed[tip.id] : null;
  const total = props.network.nodes[0]?.size || 1;

  return (
    <div className="fg nv" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        onPointerDown={(e) => {
          const { sx, sy } = local(e);
          drag.current = { sx, sy, vx: view.current.x, vy: view.current.y, moved: false };
          anim.current = null;
          (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const { sx, sy } = local(e);
          const d = drag.current;
          if (d) {
            if (!d.moved && Math.hypot(sx - d.sx, sy - d.sy) > 4) d.moved = true;
            if (d.moved) {
              view.current.x = d.vx + (sx - d.sx);
              view.current.y = d.vy + (sy - d.sy);
              dirty.current = true;
              setTip(null);
            }
            return;
          }
          const id = hit(sx, sy);
          if (id !== hoverRef.current) {
            hoverRef.current = id;
            dirty.current = true;
          }
          (e.target as HTMLCanvasElement).style.cursor = id !== null ? "pointer" : "grab";
          setTip(id !== null ? { id, x: sx, y: sy } : null);
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          drag.current = null;
          if (d && !d.moved) {
            const { sx, sy } = local(e);
            propsRef.current.onSelect(hit(sx, sy));
          }
        }}
        onPointerLeave={() => {
          hoverRef.current = null;
          dirty.current = true;
          setTip(null);
        }}
        onDoubleClick={(e) => {
          const { sx, sy } = local(e);
          const id = hit(sx, sy);
          if (id !== null) propsRef.current.onOpen?.(id);
          else zoomBy(1.8, sx, sy);
        }}
        onWheel={(e) => {
          const { sx, sy } = local(e);
          const v = view.current;
          anim.current = null;
          const k = clamp(v.k * Math.exp(-e.deltaY * 0.0016), 0.04, 8);
          v.x = sx - ((sx - v.x) * k) / v.k;
          v.y = sy - ((sy - v.y) * k) / v.k;
          v.k = k;
          dirty.current = true;
        }}
      />
      {tipNode && tip && (
        <div className="fg-tip" style={{ left: Math.min(tip.x + 14, view.current.w - 260), top: tip.y + 14 }}>
          <b className="truncate">{tipNode.n.name}</b>
          <span>
            {formatSize(tipNode.n.size)} · {((tipNode.n.size / total) * 100).toFixed(tipNode.n.size / total < 0.01 ? 2 : 1)}% of everything
            {tipNode.n.more ? "" : tipNode.n.sub ? ` · ${tipNode.n.sub} subfolders` : ""}
          </span>
        </div>
      )}
      <div className="fg-zoom" role="group" aria-label="Zoom">
        <button type="button" className="btn icon sm" title="Zoom in" onClick={() => zoomBy(1.4)}>
          <Plus />
        </button>
        <button type="button" className="btn icon sm" title="Zoom out" onClick={() => zoomBy(1 / 1.4)}>
          <Minus />
        </button>
        <button type="button" className="btn icon sm" title="Fit everything in view" onClick={() => fit(true)}>
          <Maximize />
        </button>
      </div>
    </div>
  );
}

// A link from a folder to a subfolder: a curve that bends along the rings, like a radial tree.
function curve(path: Path2D, a: Placed, b: Placed) {
  const mid = (a.radius + b.radius) / 2;
  const b1 = b.angle - Math.PI / 2;
  const a1 = a.radius === 0 ? b1 : a.angle - Math.PI / 2;
  path.moveTo(a.x, a.y);
  path.bezierCurveTo(Math.cos(a1) * mid, Math.sin(a1) * mid, Math.cos(b1) * mid, Math.sin(b1) * mid, b.x, b.y);
}

export { branchColor };
