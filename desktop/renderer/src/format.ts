export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes >= 1024 ** 4) return `${(bytes / 1024 ** 4).toFixed(2)} TB`;
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(bytes >= 100 * 1024 ** 3 ? 1 : 2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(bytes >= 100 * 1024 ** 2 ? 0 : 1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${Math.round(bytes)} B`;
}

// "29.53" and "GB" separately, for big numbers with a smaller unit.
export function sizeParts(bytes: number): [string, string] {
  const [value, unit] = formatSize(bytes).split(" ");
  return [value, unit];
}

export const formatCount = (n: number) => n.toLocaleString("en-US");

export function timeAgo(when: number | string): string {
  const ms = Date.now() - (typeof when === "string" ? Date.parse(when) : when);
  const min = Math.round(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} day${d === 1 ? "" : "s"} ago`;
  return new Date(Date.now() - ms).toLocaleDateString();
}

export function daysOld(mtime?: number): string {
  if (!mtime) return "";
  const d = Math.floor((Date.now() - mtime) / 86_400_000);
  return d <= 0 ? "today" : d === 1 ? "1 day" : `${d} days`;
}

export function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

let home = "";
export const setHome = (h: string) => {
  home = h;
};
export function shortPath(p: string): string {
  return home && p.toLowerCase().startsWith(home.toLowerCase()) ? "~" + p.slice(home.length) : p;
}
// Scan targets in sentences: the home folder reads as "your user folder".
export function displayRoot(p: string): string {
  return home && p.replace(/[\\/]+$/, "").toLowerCase() === home.toLowerCase() ? "your user folder" : shortPath(p);
}
export const baseName =(p: string) => p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || p;
export const dirName = (p: string) => p.replace(/[\\/]+$/, "").replace(/[\\/][^\\/]*$/, "") || p;

export function sentence(category: string): string {
  return category.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}
