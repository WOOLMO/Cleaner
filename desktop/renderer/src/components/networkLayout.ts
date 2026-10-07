import { stratify, tree, type HierarchyPointNode } from "d3-hierarchy";
import type { FolderNetwork, NetNode } from "../types";
import type { GNode } from "./ForceGraph";

// Turns the full folder network into nodes for the web graph. A tidy radial tree gives every folder a
// starting spot near where the physics will settle it, so thousands of folders unfold into a clean web
// instead of a tangle; each top-level branch keeps its own color.

export function branchColor(i: number, dark: boolean) {
  const hue = (i * 137.508 + 148) % 360;
  return `hsl(${hue.toFixed(1)} ${dark ? 70 : 60}% ${dark ? 62 : 46}%)`;
}

export function networkNodes(net: FolderNetwork, dark: boolean): GNode[] {
  const root = stratify<NetNode>()
    .id((d) => String(d.id))
    .parentId((d) => (d.parent < 0 ? null : String(d.parent)))(net.nodes);
  root.sort((a, b) => b.data.size - a.data.size);
  const ring = 70;
  const laid = tree<NetNode>()
    .size([2 * Math.PI, Math.max(1, root.height) * ring])
    .separation((a, b) => (a.parent === b.parent ? 1 : 1.5) / Math.max(1, a.depth))(root);
  const top = laid.children ?? [];
  const branchOf = new Map<HierarchyPointNode<NetNode>, number>();
  top.forEach((c, i) => branchOf.set(c, i));
  const biggest = Math.max(1, ...top.map((c) => c.data.size));
  const out: GNode[] = [];
  laid.each((node) => {
    let b: HierarchyPointNode<NetNode> | null = node;
    while (b && b.depth > 1) b = b.parent;
    const branch = b && b.depth === 1 ? branchOf.get(b) ?? 0 : 0;
    const n = node.data;
    const angle = node.x - Math.PI / 2;
    const share = Math.sqrt(n.size / biggest);
    out.push({
      id: String(n.id),
      parent: n.parent < 0 ? null : String(n.parent),
      label: n.name,
      kind: node.depth === 0 ? "root" : n.more ? "more" : "dir",
      size: n.size,
      count: n.sub,
      open: n.open,
      radius: node.depth === 0 ? 20 : n.more ? 4 : Math.max(2.4, Math.min(16, 2.4 + (share * 15) / Math.sqrt(node.depth))),
      color: node.depth === 0 || n.more ? undefined : branchColor(branch, dark),
      seedX: Math.cos(angle) * node.y,
      seedY: Math.sin(angle) * node.y,
      // the web unfolds outward, ring by ring, sweeping around the root
      delay: node.depth * 230 + (node.x / (2 * Math.PI)) * 260,
    });
  });
  return out;
}
