import { useEffect, useMemo, useRef, useState } from "react";
import { hierarchy, treemap, treemapSquarify } from "d3-hierarchy";
import { formatSize } from "../format";

export interface TreemapItem {
  key: string;
  name: string;
  label?: string;
  size: number;
  tone: "reclaim" | "check" | "keep" | "plain";
}

// Squarified treemap drawn with absolutely positioned tiles, so drilling in animates smoothly.
export function Treemap({ items, hot, onHover, onOpen }: {
  items: TreemapItem[];
  hot: string | null;
  onHover: (key: string | null) => void;
  onOpen: (item: TreemapItem) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setBox({ w: entry.contentRect.width, h: entry.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const tiles = useMemo(() => {
    if (!box.w || !box.h || !items.length) return [];
    const root = hierarchy<{ children?: TreemapItem[] } & Partial<TreemapItem>>({ children: items.filter((i) => i.size > 0) })
      .sum((d) => (d.children ? 0 : d.size ?? 0))
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    const laid = treemap<{ children?: TreemapItem[] } & Partial<TreemapItem>>().tile(treemapSquarify.ratio(1.25)).size([box.w, box.h]).paddingInner(4).paddingOuter(6).round(true)(root);
    return laid.leaves().map((leaf, i) => ({ item: leaf.data as TreemapItem, x: leaf.x0, y: leaf.y0, w: leaf.x1 - leaf.x0, h: leaf.y1 - leaf.y0, i }));
  }, [items, box]);

  return (
    <div className="treemap" ref={ref} onMouseLeave={() => onHover(null)}>
      {tiles.map(({ item, x, y, w, h, i }) => {
        const tiny = w < 74 || h < 46;
        return (
          <button
            key={item.key}
            type="button"
            className={`cell tone-${item.tone}${item.tone === "plain" && i % 2 ? " alt" : ""}${tiny ? " tiny" : ""}${hot === item.key ? " hot" : ""}`}
            style={{ left: x, top: y, width: w, height: h }}
            title={`${item.label ?? item.name} · ${formatSize(item.size)}`}
            onMouseEnter={() => onHover(item.key)}
            onClick={() => onOpen(item)}
          >
            <span style={{ minWidth: 0 }}>
              <div className="nm">{item.label ?? item.name}</div>
              {item.label && h > 70 && <div className="lb">{item.name}</div>}
            </span>
            {h > 34 && w > 52 && <span className="sz">{formatSize(item.size)}</span>}
          </button>
        );
      })}
    </div>
  );
}
