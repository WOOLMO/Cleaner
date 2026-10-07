import path from "node:path";

// The full folder network: every folder of a drive or user folder, sized by what it holds, trimmed to a
// node budget so it can be drawn. The biggest branches are opened first; the rest of each folder folds
// into one "+N folders" node. Input is a space map ({ root, sizes, kids, stats }).

class MaxHeap {
  constructor() {
    this.items = [];
  }
  get size() {
    return this.items.length;
  }
  push(item) {
    const a = this.items;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].size >= a[i].size) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l].size > a[m].size) m = l;
        if (r < a.length && a[r].size > a[m].size) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

export function buildNetwork({ root, sizes, kids, stats }, { budget = 5000, perFolder = 48 } = {}) {
  const sizeOf = (p) => sizes.get(p) ?? 0;
  const nodes = [{ id: 0, parent: -1, path: root, name: path.basename(root) || root, size: sizeOf(root), depth: 0, sub: (kids.get(root) ?? []).length, open: false }];
  const heap = new MaxHeap();
  heap.push({ index: 0, size: nodes[0].size });
  while (heap.size && nodes.length < budget) {
    const { index } = heap.pop();
    const parent = nodes[index];
    const children = (kids.get(parent.path) ?? []).map((p) => ({ p, size: sizeOf(p) })).sort((a, b) => b.size - a.size);
    if (!children.length) continue;
    parent.open = true;
    const room = Math.max(0, Math.min(perFolder, budget - nodes.length - 1));
    const shown = children.slice(0, room);
    for (const c of shown) {
      const id = nodes.length;
      nodes.push({ id, parent: index, path: c.p, name: path.basename(c.p), size: c.size, depth: parent.depth + 1, sub: (kids.get(c.p) ?? []).length, open: false });
      heap.push({ index: id, size: c.size });
    }
    const rest = children.slice(shown.length);
    if (rest.length) {
      nodes.push({
        id: nodes.length,
        parent: index,
        path: `${parent.path}${path.sep}…`,
        name: `${rest.length} more folders`,
        size: rest.reduce((s, c) => s + c.size, 0),
        depth: parent.depth + 1,
        sub: 0,
        open: false,
        more: rest.length,
      });
    }
  }
  return {
    root,
    nodes,
    total: { dirs: stats?.dirs ?? sizes.size, files: stats?.files ?? 0, bytes: stats?.bytes ?? nodes[0].size, unreadable: stats?.errors ?? 0 },
    shown: nodes.filter((n) => !n.more).length,
  };
}
