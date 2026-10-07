import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  forceCollide, forceLink, forceManyBody, forceRadial, forceSimulation, forceX, forceY,
  type ForceLink, type Simulation, type SimulationLinkDatum, type SimulationNodeDatum,
} from "d3-force";
import { Maximize, Minus, Plus } from "lucide-react";

// A living map of folders and files: physics layout, curved links with traffic flowing from parent to child,
// nodes that spring out of their folder when it opens and fold back into it when it closes.

export interface GNode {
  id: string;
  parent: string | null;
  label: string;
  kind: "root" | "dir" | "file" | "more";
  size?: number;
  count?: number;
  category?: string;
  tone?: "accent" | "amber" | "new";
  open?: boolean;
}

export type GraphLayout = "web" | "rings";

interface SimNode extends SimulationNodeDatum, GNode {
  r: number;
  depth: number;
  born: number;
  bend: number;
  seed: number;
}
type SimLink = SimulationLinkDatum<SimNode> & { source: SimNode; target: SimNode };
interface Ghost {
  node: SimNode;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  start: number;
}

const BORN_MS = 520;
// No frames get painted while the window is hidden or in screenshot mode (which reports itself visible),
// so the layout is settled up front and the loop runs on a timer.
const offscreen = () => document.visibilityState === "hidden" || Boolean(window.cleanerWindow?.capture);
const GHOST_MS = 320;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const easeOutBack = (t: number) => 1 + 2.4 * Math.pow(t - 1, 3) + 1.4 * Math.pow(t - 1, 2);
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967295;
}

export function radiusOf(n: GNode) {
  if (n.kind === "root") return 18;
  if (n.kind === "more") return 9;
  if (n.kind === "dir") return 6.5 + Math.min(9, Math.sqrt(n.count ?? 0) * 1.25);
  return 2.6 + Math.min(5, Math.log10((n.size ?? 0) / 1024 + 1) * 1.15);
}

// Colors per kind of file; each theme gets its own set so they read well on both backgrounds.
const KIND_COLORS: Record<"dark" | "light", Record<string, string>> = {
  dark: {
    documents: "#7fa9ff", spreadsheets: "#4fe08f", presentations: "#f2b84b", images: "#b59bff", screenshots: "#cbb8ff",
    videos: "#f06a6e", audio: "#ff8fc7", archives: "#d9a46a", installers: "#4fd1c5", "disk-images": "#4fd1c5",
    code: "#9be36b", design: "#e58fff", "3d": "#e58fff", fonts: "#8fb7ff", ebooks: "#8fb7ff", other: "#6e7a73",
  },
  light: {
    documents: "#2f6fe4", spreadsheets: "#16a35a", presentations: "#b97a0c", images: "#7c5ce0", screenshots: "#9a7fe8",
    videos: "#d63d43", audio: "#cf3f8a", archives: "#a5672a", installers: "#0f9488", "disk-images": "#0f9488",
    code: "#4c9a1c", design: "#a63fc7", "3d": "#a63fc7", fonts: "#3d6fd6", ebooks: "#3d6fd6", other: "#7d8882",
  },
};
export const kindColor = (category: string | undefined, theme: "dark" | "light") => KIND_COLORS[theme][category ?? "other"] ?? KIND_COLORS[theme].other;

interface Palette {
  theme: "dark" | "light";
  bg: string;
  surface: string;
  surface2: string;
  line: string;
  lineStrong: string;
  text: string;
  text2: string;
  text3: string;
  accent: string;
  amber: string;
  font: string;
  mono: string;
}
function readPalette(): Palette {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return {
    theme: document.documentElement.dataset.theme === "light" ? "light" : "dark",
    bg: v("--bg"),
    surface: v("--surface"),
    surface2: v("--surface-2"),
    line: v("--line"),
    lineStrong: v("--line-strong"),
    text: v("--text"),
    text2: v("--text-2"),
    text3: v("--text-3"),
    accent: v("--accent"),
    amber: v("--amber"),
    font: v("--font"),
    mono: v("--mono"),
  };
}

export function ForceGraph(props: {
  nodes: GNode[];
  layout?: GraphLayout;
  selected?: string | null;
  emphasis?: Set<string> | null; // ids to bring forward; everything else fades
  onNodeClick?: (n: GNode) => void;
  onNodeOpen?: (n: GNode) => void;
  tooltip?: (n: GNode) => { title: string; sub?: string };
  children?: ReactNode; // overlays (legend, search...)
  fitKey?: string | number; // change it to refit the view
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null);
  const nodesRef = useRef(new Map<string, SimNode>());
  const linksRef = useRef<SimLink[]>([]);
  const ghostsRef = useRef<Ghost[]>([]);
  const ripplesRef = useRef<{ x: number; y: number; start: number }[]>([]);
  const view = useRef({ x: 0, y: 0, k: 1, w: 0, h: 0 });
  const viewAnim = useRef<{ from: { x: number; y: number; k: number }; to: { x: number; y: number; k: number }; start: number } | null>(null);
  const hoverRef = useRef<SimNode | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const paletteRef = useRef<Palette | null>(null);
  const fittedRef = useRef(false);
  // While the layout unfolds the camera follows it, until the user takes over or it settles.
  const followRef = useRef(false);
  const [hover, setHover] = useState<{ node: GNode; x: number; y: number } | null>(null);

  // ---------- simulation ----------
  if (!simRef.current) {
    simRef.current = forceSimulation<SimNode, SimLink>([])
      .velocityDecay(0.34)
      .alphaDecay(0.018)
      .stop();
  }

  useEffect(() => {
    const sim = simRef.current!;
    const layout = props.layout ?? "web";
    const link = forceLink<SimNode, SimLink>(linksRef.current)
      .id((d) => d.id)
      .distance((l) => (l.target.kind === "file" ? 16 : 40) + l.source.r + l.target.r + (layout === "rings" ? 0 : Math.min(40, (l.target.count ?? 0) * 0.6)))
      .strength((l) => (layout === "rings" ? 0.12 : l.target.kind === "file" ? 0.9 : 0.6));
    sim
      .force("link", link)
      .force("charge", forceManyBody<SimNode>().strength((d) => (d.kind === "root" ? -700 : d.kind === "dir" ? -210 : d.kind === "more" ? -90 : -26)).distanceMax(460))
      .force("collide", forceCollide<SimNode>().radius((d) => d.r + (d.kind === "file" ? 1.6 : 5)).iterations(2));
    if (layout === "rings") {
      sim
        .force("radial", forceRadial<SimNode>((d) => d.depth * 132, 0, 0).strength((d) => (d.depth === 0 ? 1 : 0.86)))
        .force("x", null)
        .force("y", null);
    } else {
      sim.force("radial", null).force("x", forceX<SimNode>(0).strength(0.035)).force("y", forceY<SimNode>(0).strength(0.035));
    }
    for (const n of nodesRef.current.values()) {
      if (n.kind !== "root") continue;
      n.fx = layout === "rings" ? 0 : null;
      n.fy = layout === "rings" ? 0 : null;
    }
    sim.alpha(Math.max(sim.alpha(), 0.85));
    if (offscreen() && nodesRef.current.size) {
      sim.tick(200);
      setTimeout(() => fit(false), 0);
    } else if (fittedRef.current) followRef.current = true;
  }, [props.layout]);

  // Diff the incoming nodes against the live ones so existing nodes keep their place.
  useEffect(() => {
    const sim = simRef.current!;
    const old = nodesRef.current;
    const next = new Map<string, SimNode>();
    const now = performance.now();
    let added = 0;
    for (const n of props.nodes) {
      let s = old.get(n.id);
      if (s) {
        Object.assign(s, n);
      } else {
        const parent = n.parent ? (next.get(n.parent) ?? old.get(n.parent)) : null;
        const a = hash(n.id) * Math.PI * 2;
        s = {
          ...n,
          x: (parent?.x ?? 0) + Math.cos(a) * 4,
          y: (parent?.y ?? 0) + Math.sin(a) * 4,
          vx: 0,
          vy: 0,
          r: 0,
          depth: 0,
          born: now + Math.min(260, added * 3),
          bend: hash(n.id + "~") > 0.5 ? 1 : -1,
          seed: hash(n.id + "#"),
        };
        added++;
        if (parent && !ripplesRef.current.some((r) => now - r.start < 200 && r.x === parent.x && r.y === parent.y)) {
          ripplesRef.current.push({ x: parent.x ?? 0, y: parent.y ?? 0, start: now });
        }
      }
      next.set(n.id, s);
    }
    for (const s of next.values()) {
      let depth = 0;
      let p = s.parent;
      while (p && next.has(p) && depth < 64) {
        depth++;
        p = next.get(p)!.parent;
      }
      s.depth = depth;
      s.r = radiusOf(s);
    }
    // Nodes that went away fold back into their folder.
    for (const [id, s] of old) {
      if (next.has(id)) continue;
      let target: SimNode | undefined;
      let p = s.parent;
      while (p && !target) {
        target = next.get(p);
        p = old.get(p)?.parent ?? null;
      }
      ghostsRef.current.push({ node: s, fromX: s.x ?? 0, fromY: s.y ?? 0, toX: target?.x ?? s.x ?? 0, toY: target?.y ?? s.y ?? 0, start: now });
    }
    nodesRef.current = next;
    const list = [...next.values()];
    const root = list.find((n) => n.kind === "root");
    if (root && (props.layout ?? "web") === "rings") {
      root.fx = 0;
      root.fy = 0;
    } else if (root) {
      root.fx = null;
      root.fy = null;
    }
    linksRef.current = list.filter((n) => n.parent && next.has(n.parent)).map((n) => ({ source: next.get(n.parent!)!, target: n }));
    sim.nodes(list);
    (sim.force("link") as ForceLink<SimNode, SimLink> | undefined)?.links(linksRef.current);
    sim.force("collide", forceCollide<SimNode>().radius((d) => d.r + (d.kind === "file" ? 1.6 : 5)).iterations(2));
    if (added || old.size !== next.size) sim.alpha(Math.max(sim.alpha(), old.size === 0 ? 1 : 0.55));
    // A hidden window (screenshot mode) paints no frames, so settle the layout right away.
    const hidden = offscreen();
    if (hidden && added) sim.tick(old.size === 0 ? 220 : 140);
    if (old.size === 0 && list.length) {
      fittedRef.current = true;
      if (hidden) setTimeout(() => fit(false), 0);
      else followRef.current = true;
    }
  }, [props.nodes]);

  useEffect(() => {
    if (props.fitKey !== undefined && nodesRef.current.size) followRef.current = true;
  }, [props.fitKey]);

  // ---------- view ----------
  function bounds() {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of nodesRef.current.values()) {
      x0 = Math.min(x0, (n.x ?? 0) - n.r);
      y0 = Math.min(y0, (n.y ?? 0) - n.r);
      x1 = Math.max(x1, (n.x ?? 0) + n.r);
      y1 = Math.max(y1, (n.y ?? 0) + n.r + 14);
    }
    return Number.isFinite(x0) ? { x0, y0, x1, y1 } : { x0: -100, y0: -100, x1: 100, y1: 100 };
  }
  function fitTarget() {
    const v = view.current;
    if (!v.w) return null;
    const b = bounds();
    // room for the search box above and the legend below
    const padX = 56, top = 64, bottom = 92;
    const k = clamp(Math.min((v.w - padX * 2) / Math.max(1, b.x1 - b.x0), (v.h - top - bottom) / Math.max(1, b.y1 - b.y0)), 0.18, 1.5);
    return { k, x: v.w / 2 - ((b.x0 + b.x1) / 2) * k, y: top + (v.h - top - bottom) / 2 - ((b.y0 + b.y1) / 2) * k };
  }
  function fit(animate: boolean) {
    const v = view.current;
    const to = fitTarget();
    if (!to) return;
    fittedRef.current = true;
    if (!animate || offscreen()) Object.assign(v, to);
    else viewAnim.current = { from: { x: v.x, y: v.y, k: v.k }, to, start: performance.now() };
  }
  function zoomBy(factor: number, cx = view.current.w / 2, cy = view.current.h / 2) {
    const v = view.current;
    followRef.current = false;
    const k = clamp(v.k * factor, 0.12, 4);
    viewAnim.current = { from: { x: v.x, y: v.y, k: v.k }, to: { k, x: cx - ((cx - v.x) * k) / v.k, y: cy - ((cy - v.y) * k) / v.k }, start: performance.now() };
  }
  const toGraph = (sx: number, sy: number) => ({ x: (sx - view.current.x) / view.current.k, y: (sy - view.current.y) / view.current.k });
  function hit(sx: number, sy: number): SimNode | null {
    const { x, y } = toGraph(sx, sy);
    const slack = 4 / view.current.k;
    let best: SimNode | null = null;
    let bestD = Infinity;
    for (const n of nodesRef.current.values()) {
      const d = Math.hypot((n.x ?? 0) - x, (n.y ?? 0) - y);
      if (d <= n.r + slack && d < bestD) {
        best = n;
        bestD = d;
      }
    }
    return best;
  }

  // ---------- render loop ----------
  useEffect(() => {
    const canvas = canvasRef.current!;
    const wrap = wrapRef.current!;
    const ctx = canvas.getContext("2d")!;
    paletteRef.current = readPalette();
    const themeWatch = new MutationObserver(() => (paletteRef.current = readPalette()));
    themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

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
      if (first) {
        view.current.x = rect.width / 2;
        view.current.y = rect.height / 2;
      }
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    let raf = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const frame = () => {
      const sim = simRef.current!;
      if (sim.alpha() > sim.alphaMin() || sim.alphaTarget() > 0) sim.tick();
      draw(ctx, performance.now());
      if (offscreen()) timer = setTimeout(frame, 40);
      else raf = requestAnimationFrame(frame);
    };
    frame();
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      ro.disconnect();
      themeWatch.disconnect();
    };
  }, []);

  function draw(ctx: CanvasRenderingContext2D, now: number) {
    const pal = paletteRef.current ?? readPalette();
    const v = view.current;
    const dpr = window.devicePixelRatio || 1;
    if (viewAnim.current) {
      const a = viewAnim.current;
      const t = clamp((now - a.start) / 620, 0, 1);
      const e = easeInOut(t);
      v.k = a.from.k + (a.to.k - a.from.k) * e;
      v.x = a.from.x + (a.to.x - a.from.x) * e;
      v.y = a.from.y + (a.to.y - a.from.y) * e;
      if (t >= 1) viewAnim.current = null;
    } else if (followRef.current) {
      const to = fitTarget();
      if (to) {
        const f = 0.075;
        v.k += (to.k - v.k) * f;
        v.x += (to.x - v.x) * f;
        v.y += (to.y - v.y) * f;
      }
      const sim = simRef.current!;
      if (sim.alpha() < 0.03 && to && Math.abs(to.k - v.k) < 0.002) followRef.current = false;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, v.w, v.h);

    // dot grid that moves with the map
    const step = 28 * v.k;
    if (step > 9) {
      ctx.fillStyle = pal.line;
      const ox = ((v.x % step) + step) % step;
      const oy = ((v.y % step) + step) % step;
      const dot = Math.max(0.8, Math.min(1.4, v.k));
      for (let x = ox; x < v.w; x += step) for (let y = oy; y < v.h; y += step) ctx.fillRect(x, y, dot, dot);
    }

    ctx.setTransform(dpr * v.k, 0, 0, dpr * v.k, dpr * v.x, dpr * v.y);
    const { selected, emphasis } = propsRef.current;
    const nodes = nodesRef.current;
    const hovered = hoverRef.current;

    // The highlighted path: from the hovered (or selected) node up to the root.
    const path = new Set<string>();
    const focus = hovered ?? (selected ? nodes.get(selected) : undefined);
    for (let p: string | null | undefined = focus?.id; p && nodes.has(p); p = nodes.get(p)!.parent) path.add(p);
    const lit = new Set<string>();
    if (emphasis?.size) {
      for (const id of emphasis) for (let p: string | null | undefined = id; p && nodes.has(p) && !lit.has(p); p = nodes.get(p)!.parent) lit.add(p);
    }
    const dimmed = (id: string) => Boolean(emphasis && emphasis.size && !lit.has(id) && !path.has(id));

    const grow = (n: SimNode) => (now < n.born ? 0 : easeOutBack(clamp((now - n.born) / BORN_MS, 0, 1)));
    const k = v.k;

    // links
    const curve = (s: SimNode, t: SimNode) => {
      const sx = s.x ?? 0, sy = s.y ?? 0, tx = t.x ?? 0, ty = t.y ?? 0;
      const dx = tx - sx, dy = ty - sy;
      const cx = (sx + tx) / 2 - dy * 0.14 * t.bend;
      const cy = (sy + ty) / 2 + dx * 0.14 * t.bend;
      return { sx, sy, tx, ty, cx, cy };
    };
    ctx.lineCap = "round";
    for (const l of linksRef.current) {
      const g = grow(l.target);
      if (g <= 0) continue;
      const c = curve(l.source, l.target);
      const on = path.has(l.target.id);
      const faded = dimmed(l.target.id);
      ctx.globalAlpha = (faded ? 0.12 : on ? 1 : l.target.kind === "file" ? 0.55 : 0.85) * Math.min(1, g);
      ctx.strokeStyle = on ? pal.accent : l.target.tone === "accent" ? pal.accent : pal.lineStrong;
      ctx.lineWidth = (on ? 2 : l.target.kind === "file" ? 0.8 : 1.2) / Math.max(0.6, Math.min(k, 1.4));
      ctx.beginPath();
      ctx.moveTo(c.sx, c.sy);
      // grow the link out of the parent as the child is born
      if (g < 1) {
        const t = clamp(g, 0, 1);
        const qx = (1 - t) * (1 - t) * c.sx + 2 * (1 - t) * t * c.cx + t * t * c.tx;
        const qy = (1 - t) * (1 - t) * c.sy + 2 * (1 - t) * t * c.cy + t * t * c.ty;
        ctx.quadraticCurveTo(c.sx + (c.cx - c.sx) * t, c.sy + (c.cy - c.sy) * t, qx, qy);
      } else ctx.quadraticCurveTo(c.cx, c.cy, c.tx, c.ty);
      ctx.stroke();
    }

    // traffic: small particles travelling from each folder to what it holds
    if (linksRef.current.length < 2600) {
      for (const l of linksRef.current) {
        const on = path.has(l.target.id);
        if (!on && (l.target.kind === "file" || dimmed(l.target.id))) continue;
        if (grow(l.target) < 1) continue;
        const c = curve(l.source, l.target);
        const speed = on ? 1 / 900 : 1 / 2600;
        const t = (now * speed + l.target.seed) % 1;
        const x = (1 - t) * (1 - t) * c.sx + 2 * (1 - t) * t * c.cx + t * t * c.tx;
        const y = (1 - t) * (1 - t) * c.sy + 2 * (1 - t) * t * c.cy + t * t * c.ty;
        ctx.globalAlpha = on ? 0.95 : 0.4 * Math.sin(t * Math.PI);
        ctx.fillStyle = on ? pal.accent : pal.text3;
        ctx.beginPath();
        ctx.arc(x, y, (on ? 2.2 : 1.5) / Math.max(0.7, Math.min(k, 1.3)), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // ripples where a folder just opened
    ripplesRef.current = ripplesRef.current.filter((r) => now - r.start < 700);
    for (const r of ripplesRef.current) {
      const t = (now - r.start) / 700;
      ctx.globalAlpha = (1 - t) * 0.5;
      ctx.strokeStyle = pal.accent;
      ctx.lineWidth = 1.5 / k;
      ctx.beginPath();
      ctx.arc(r.x, r.y, 10 + t * 46, 0, Math.PI * 2);
      ctx.stroke();
    }

    // folding nodes
    ghostsRef.current = ghostsRef.current.filter((g) => now - g.start < GHOST_MS);
    for (const g of ghostsRef.current) {
      const t = easeInOut(clamp((now - g.start) / GHOST_MS, 0, 1));
      const x = g.fromX + (g.toX - g.fromX) * t;
      const y = g.fromY + (g.toY - g.fromY) * t;
      ctx.globalAlpha = (1 - t) * 0.8;
      ctx.strokeStyle = pal.lineStrong;
      ctx.lineWidth = 1 / k;
      ctx.beginPath();
      ctx.moveTo(g.toX, g.toY);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.fillStyle = g.node.kind === "file" ? kindColor(g.node.category, pal.theme) : pal.surface2;
      ctx.beginPath();
      ctx.arc(x, y, g.node.r * (1 - t * 0.7), 0, Math.PI * 2);
      ctx.fill();
    }

    // nodes: files under folders, the root on top
    const order = [...nodes.values()].sort((a, b) => rank(a) - rank(b));
    for (const n of order) {
      const g = grow(n);
      if (g <= 0) continue;
      const x = n.x ?? 0, y = n.y ?? 0;
      const r = n.r * g;
      const faded = dimmed(n.id);
      const on = path.has(n.id);
      ctx.globalAlpha = faded ? 0.18 : 1;

      if (n.kind === "root") {
        const breathe = 1 + Math.sin(now / 700) * 0.08;
        ctx.globalAlpha = faded ? 0.1 : 0.18;
        ctx.fillStyle = pal.accent;
        ctx.beginPath();
        ctx.arc(x, y, r + 10 * breathe, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = faded ? 0.18 : 1;
        ctx.fillStyle = pal.accent;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = pal.surface;
        ctx.beginPath();
        ctx.arc(x, y, r * 0.42, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      if (n.kind === "file") {
        ctx.fillStyle = kindColor(n.category, pal.theme);
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      } else if (n.kind === "more") {
        ctx.fillStyle = pal.surface;
        ctx.strokeStyle = pal.text3;
        ctx.lineWidth = 1.2 / Math.max(0.7, k);
        ctx.setLineDash([3 / Math.max(0.6, k), 3 / Math.max(0.6, k)]);
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        ctx.fillStyle = n.open ? pal.surface2 : pal.surface;
        ctx.strokeStyle = on ? pal.accent : n.open ? pal.text3 : pal.lineStrong;
        ctx.lineWidth = (on ? 2 : 1.4) / Math.max(0.7, Math.min(k, 1.5));
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        // a closed folder with things inside shows a filled core
        if (!n.open && (n.count ?? 0) > 0) {
          ctx.fillStyle = pal.text3;
          ctx.globalAlpha *= 0.55;
          ctx.beginPath();
          ctx.arc(x, y, Math.max(1.6, r * 0.28), 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = faded ? 0.18 : 1;
        }
      }
      if (n.tone) {
        const color = n.tone === "amber" ? pal.amber : pal.accent;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5 / Math.max(0.7, Math.min(k, 1.5));
        if (n.tone === "new") ctx.setLineDash([4 / Math.max(0.6, k), 3 / Math.max(0.6, k)]);
        ctx.beginPath();
        ctx.arc(x, y, r + 3.2, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (n.id === selected || n === hovered) {
        ctx.strokeStyle = pal.accent;
        ctx.lineWidth = 2 / k;
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.arc(x, y, r + (n.tone ? 7 : 4.5), 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // labels, drawn last so they sit above everything
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.lineJoin = "round";
    // Labels claim screen space in priority order (root, the lit path, shallow folders, big things);
    // a label that would overlap one already placed is skipped until zooming in makes room.
    const candidates: { n: SimNode; on: boolean; prio: number }[] = [];
    for (const n of order) {
      if (grow(n) < 0.6) continue;
      const on = path.has(n.id) || n.id === selected || n === hovered || lit.has(n.id);
      const show =
        n.kind === "root" ||
        on ||
        (n.kind === "dir" && k * n.r > 5.5) ||
        (n.kind === "more" && k > 0.7) ||
        (n.kind === "file" && k > 1.7);
      if (!show || (dimmed(n.id) && !on)) continue;
      const prio = n.kind === "root" ? 0 : n === hovered || n.id === selected ? 1 : on ? 2 : 3 + n.depth * 2 + (n.kind === "dir" ? 0 : 1) - n.r / 40;
      candidates.push({ n, on, prio });
    }
    candidates.sort((a, b) => a.prio - b.prio);
    const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
    for (const { n, on } of candidates) {
      const g = grow(n);
      const size = n.kind === "root" ? 13 : n.kind === "file" ? 10.5 : 11.5;
      ctx.font = `${n.kind === "root" ? 600 : on || n.kind === "dir" ? 500 : 400} ${size / k}px ${pal.font}`;
      const max = n.kind === "file" ? 26 : 24;
      const text = n.label.length > max ? n.label.slice(0, max - 1) + "…" : n.label;
      const y = (n.y ?? 0) + n.r * g + 5 / k;
      const half = ctx.measureText(text).width / 2 + 2 / k;
      const box = { x0: (n.x ?? 0) - half, y0: y - 1 / k, x1: (n.x ?? 0) + half, y1: y + (size + 2) / k };
      if (placed.some((p) => box.x0 < p.x1 && box.x1 > p.x0 && box.y0 < p.y1 && box.y1 > p.y0)) continue;
      placed.push(box);
      ctx.globalAlpha = Math.min(1, (g - 0.6) / 0.3);
      ctx.strokeStyle = pal.bg;
      ctx.lineWidth = 3.5 / k;
      ctx.strokeText(text, n.x ?? 0, y);
      ctx.fillStyle = on ? pal.text : n.kind === "file" ? pal.text3 : pal.text2;
      ctx.fillText(text, n.x ?? 0, y);
    }
    ctx.globalAlpha = 1;
  }

  // ---------- input ----------
  const drag = useRef<{ node: SimNode | null; sx: number; sy: number; vx: number; vy: number; moved: boolean } | null>(null);
  const local = (e: { clientX: number; clientY: number }) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { sx: e.clientX - rect.left, sy: e.clientY - rect.top };
  };

  return (
    <div className="fg" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        onPointerDown={(e) => {
          const { sx, sy } = local(e);
          const node = hit(sx, sy);
          drag.current = { node, sx, sy, vx: view.current.x, vy: view.current.y, moved: false };
          viewAnim.current = null;
          followRef.current = false;
          (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const { sx, sy } = local(e);
          const d = drag.current;
          if (d) {
            if (!d.moved && Math.hypot(sx - d.sx, sy - d.sy) > 4) {
              d.moved = true;
              if (d.node) simRef.current!.alphaTarget(0.25);
            }
            if (!d.moved) return;
            if (d.node) {
              const g = toGraph(sx, sy);
              d.node.fx = g.x;
              d.node.fy = g.y;
            } else {
              view.current.x = d.vx + (sx - d.sx);
              view.current.y = d.vy + (sy - d.sy);
            }
            setHover(null);
            return;
          }
          const n = hit(sx, sy);
          hoverRef.current = n;
          (e.target as HTMLCanvasElement).style.cursor = n ? "pointer" : "grab";
          setHover((h) => (n ? { node: n, x: sx, y: sy } : h ? null : h));
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          drag.current = null;
          if (!d) return;
          if (d.node && d.moved) {
            simRef.current!.alphaTarget(0);
            const rings = (propsRef.current.layout ?? "web") === "rings";
            if (!(rings && d.node.kind === "root")) {
              d.node.fx = null;
              d.node.fy = null;
            }
          }
          if (!d.moved && d.node) propsRef.current.onNodeClick?.(d.node);
          if (e.pointerType !== "mouse") hoverRef.current = null;
        }}
        onPointerLeave={() => {
          hoverRef.current = null;
          setHover(null);
        }}
        onDoubleClick={(e) => {
          const { sx, sy } = local(e);
          const n = hit(sx, sy);
          if (n) propsRef.current.onNodeOpen?.(n);
          else zoomBy(1.6, sx, sy);
        }}
        onWheel={(e) => {
          const { sx, sy } = local(e);
          const v = view.current;
          viewAnim.current = null;
          followRef.current = false;
          const k = clamp(v.k * Math.exp(-e.deltaY * 0.0016), 0.12, 4);
          v.x = sx - ((sx - v.x) * k) / v.k;
          v.y = sy - ((sy - v.y) * k) / v.k;
          v.k = k;
        }}
      />
      {hover && props.tooltip && (
        <div className="fg-tip" style={{ left: Math.min(hover.x + 14, view.current.w - 260), top: hover.y + 14 }}>
          <b className="truncate">{props.tooltip(hover.node).title}</b>
          {props.tooltip(hover.node).sub && <span>{props.tooltip(hover.node).sub}</span>}
        </div>
      )}
      <div className="fg-zoom" role="group" aria-label="Zoom">
        <button type="button" className="btn icon sm" title="Zoom in" onClick={() => zoomBy(1.35)}>
          <Plus />
        </button>
        <button type="button" className="btn icon sm" title="Zoom out" onClick={() => zoomBy(1 / 1.35)}>
          <Minus />
        </button>
        <button type="button" className="btn icon sm" title="Fit everything in view" onClick={() => { followRef.current = false; fit(true); }}>
          <Maximize />
        </button>
      </div>
      {props.children}
    </div>
  );
}

const rank = (n: SimNode) => (n.kind === "file" ? 0 : n.kind === "more" ? 1 : n.kind === "dir" ? 2 : 3);
