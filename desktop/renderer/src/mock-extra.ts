// Sample data for the organizer and the folder graph in demo mode. All made up.
import type { CleanerApi, GraphNode, OrganizeMove, OrganizePlan, OrganizeRun, Verdict } from "./types";

const HOME = "C:\\Users\\alex";
const MB = 1024 ** 2;
const DAY = 86_400_000;
const now = Date.now();
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- organizer ----------
type Loose = [name: string, mb: number, folder: string | null, isNew: boolean, source: "rules" | "gemini", reason: string, category: string | null];
const LOOSE: Loose[] = [
  ["IMG_4021.jpg", 4.2, "Photos", false, "rules", "\"Photos\" already holds your images", "images"],
  ["IMG_4022.jpg", 3.9, "Photos", false, "rules", "\"Photos\" already holds your images", "images"],
  ["beach-sunset.heic", 2.8, "Photos", false, "rules", "\"Photos\" already holds your images", "images"],
  ["profile-pic.png", 0.6, "Photos", false, "rules", "\"Photos\" already holds your images", "images"],
  ["Screenshot 2026-09-14 101522.png", 0.9, "Screenshots", true, "rules", "New \"Screenshots\" folder for screenshots", "screenshots"],
  ["Screenshot 2026-09-30 220144.png", 1.1, "Screenshots", true, "rules", "New \"Screenshots\" folder for screenshots", "screenshots"],
  ["Screenshot 2026-10-02 090311.png", 0.7, "Screenshots", true, "rules", "New \"Screenshots\" folder for screenshots", "screenshots"],
  ["Screenshot 2026-10-04 181207.png", 1.3, "Screenshots", true, "rules", "New \"Screenshots\" folder for screenshots", "screenshots"],
  ["invoice-acme-0925.pdf", 0.2, "Invoices", true, "gemini", "Invoices grouped together", "documents"],
  ["invoice-acme-1025.pdf", 0.2, "Invoices", true, "gemini", "Invoices grouped together", "documents"],
  ["invoice-hosting-q3.pdf", 0.1, "Invoices", true, "gemini", "Invoices grouped together", "documents"],
  ["Q3 report final.docx", 1.4, "Work", false, "gemini", "Quarterly report, fits your Work folder", "documents"],
  ["client-brief-northwind.pdf", 2.2, "Work", false, "gemini", "Client brief, fits your Work folder", "documents"],
  ["school-essay-draft.docx", 0.3, "School", false, "rules", "Its name matches your \"School\" folder", "documents"],
  ["resume-2026.pdf", 0.4, "Documents", true, "rules", "New \"Documents\" folder for documents", "documents"],
  ["lease-agreement.pdf", 1.8, "Documents", true, "rules", "New \"Documents\" folder for documents", "documents"],
  ["budget-2026.xlsx", 0.1, "Documents", true, "gemini", "Personal budget, kept with your documents", "spreadsheets"],
  ["screen-recording-1002.mp4", 212, "Videos", true, "rules", "New \"Videos\" folder for videos", "videos"],
  ["trip-montage.mov", 486, "Videos", true, "rules", "New \"Videos\" folder for videos", "videos"],
  ["voice-memo-0911.m4a", 3.2, "Music", true, "rules", "New \"Music\" folder for audio files", "audio"],
  ["assets-pack.zip", 96, "Archives", true, "rules", "New \"Archives\" folder for archives", "archives"],
  ["fonts-bundle.7z", 14, "Archives", true, "rules", "New \"Archives\" folder for archives", "archives"],
  ["Discord-Setup.exe", 98, "Installers", true, "rules", "New \"Installers\" folder for installers", "installers"],
  ["vlc-3.0.21-win64.exe", 42, "Installers", true, "rules", "New \"Installers\" folder for installers", "installers"],
  ["python-3.13.1-amd64.exe", 27, "Installers", true, "rules", "New \"Installers\" folder for installers", "installers"],
  ["scratch.py", 0.01, "Side Projects", false, "gemini", "Python script, belongs with your side projects", "code"],
  ["elden-ring-save-backup.zip", 18, "Games", false, "gemini", "Game save backup, fits your Games folder", "archives"],
  ["random.dat", 0.5, null, false, "rules", "No obvious place for this kind of file", null],
];

function makePlan(root: string): OrganizePlan {
  const files = LOOSE.map(([name, mb, , , , , category], i) => ({ id: i + 1, name, size: Math.round(mb * MB), mtime: now - (i + 2) * DAY, ext: name.split(".").pop() ?? "", category }));
  const moves: OrganizeMove[] = [];
  const stay: OrganizePlan["stay"] = [];
  LOOSE.forEach(([, , folder, isNew, source, reason, category], i) => {
    if (folder) moves.push({ id: i + 1, folder, isNew, source, reason, category });
    else stay.push({ id: i + 1, reason });
  });
  return {
    root,
    style: {
      language: "en",
      languageName: "English",
      languageSource: "folders",
      casing: "title",
      numbering: null,
      detected: true,
      sampleNames: ["Games", "Photos", "School", "Side Projects", "Work"],
    },
    folders: [
      { name: "Games", dominant: null, files: 12, project: false },
      { name: "Photos", dominant: "images", files: 214, project: false },
      { name: "School", dominant: "documents", files: 38, project: false },
      { name: "Side Projects", dominant: "code", files: 380, project: false },
      { name: "Work", dominant: "documents", files: 66, project: false },
    ],
    files,
    skipped: [
      { name: "Spotify.lnk", size: 2048, reason: "shortcut" },
      { name: "desktop.ini", size: 282, reason: "system or in-progress file" },
      { name: "~$Q3 report final.docx", size: 162, reason: "hidden or lock file" },
    ],
    moves,
    stay,
    planner: "gemini-3.5-flash-lite",
    aiError: null,
  };
}

let plan: OrganizePlan | null = null;
let history: OrganizeRun[] = [
  {
    id: "2026-10-04T18-12-40-000Z",
    root: `${HOME}\\Downloads`,
    time: new Date(now - 3 * DAY).toISOString(),
    moved: 48,
    bytes: 3.1 * 1024 * MB,
    createdFolders: 5,
    folders: ["Installers", "Archives", "Documents", "Images", "Videos", "Music"],
    failed: [],
    undoneAt: null,
    restored: null,
  },
];

// ---------- folder graph ----------
// A folder is an object, a file is its size in MB.
type Spec = { [name: string]: Spec | number };
const TREE: Spec = {
  Desktop: {
    Work: { "Q2 report.docx": 1.2, "pitch-deck-v7.pptx": 18, "client-brief.pdf": 2, Contracts: { "nda-northwind.pdf": 0.3, "msa-2026.pdf": 0.6 } },
    Photos: { "IMG_3998.jpg": 4, "IMG_3999.jpg": 4.4, "sunset.heic": 3, "family.png": 2.1 },
    School: { "thesis-outline.docx": 0.2, "lecture-notes.md": 0.05, "dataset.csv": 12 },
    Games: { "saves.zip": 22, "mods-list.txt": 0.01 },
    "Side Projects": { "landing-page": { "index.html": 0.02, "style.css": 0.01, "app.js": 0.04 }, "notes.md": 0.01 },
    "IMG_4021.jpg": 4.2,
    "Screenshot 2026-10-04 181207.png": 1.3,
    "trip-montage.mov": 486,
    "Discord-Setup.exe": 98,
  },
  Documents: {
    Invoices: { "2025": { "acme-11.pdf": 0.2, "acme-12.pdf": 0.2, "hosting-q4.pdf": 0.1 }, "2026": { "acme-09.pdf": 0.2, "acme-10.pdf": 0.2 } },
    Taxes: { "return-2025.pdf": 1.1, "receipts.zip": 34 },
    Notes: { "ideas.md": 0.02, "reading-list.md": 0.01, "meeting-0928.md": 0.01 },
    "Q3 report.docx": 1.4,
    "lease-agreement.pdf": 1.8,
    "budget-2026.xlsx": 0.1,
  },
  Downloads: {
    "trip-photos": { "DSC_0101.jpg": 6, "DSC_0102.jpg": 6.3, "DSC_0103.jpg": 5.8, "DSC_0104.jpg": 6.1, "DSC_0105.jpg": 5.9 },
    "DaVinci_Resolve_21.0.3_Windows.exe": 3530,
    "trip-photos.zip": 1566,
    "nvidia-driver-610.88-win11.exe": 932,
    "Unconfirmed 633898.crdownload": 3520,
    "blender-5.1.2-windows-x64 (1).msi": 354,
    "blender-5.1.2-windows-x64.msi": 354,
    "screen-recording-0918 (1).mp4": 297,
    "paper-draft.pdf": 2.4,
    "font-pack.zip": 24,
  },
  Pictures: {
    "Camera Roll": { "2025": { "IMG_1001.jpg": 3.8, "IMG_1002.jpg": 4.1, "IMG_1003.jpg": 3.6 }, "2026": { "IMG_2001.heic": 2.9, "IMG_2002.heic": 3.1 } },
    Screenshots: { "Screenshot 2026-08-01.png": 0.9, "Screenshot 2026-08-14.png": 1.2, "Screenshot 2026-09-02.png": 0.8 },
    Wallpapers: { "mountains-4k.jpg": 8.2, "aurora.png": 11, "city-night.jpg": 6.4 },
    Backup: { "dinner.jpg": 6.1 },
    "dinner.jpg": 6.1,
  },
  Videos: {
    Recordings: { "stream-0921.mp4": 3200, "stream-0928.mp4": 2900, "tutorial-raw.mkv": 4100 },
    Edits: { "intro-v3.mp4": 88, "outro.mp4": 41 },
    "screen-recording-0918.mp4": 297,
  },
  Music: { Playlists: { "focus.m3u": 0.01, "gym.m3u": 0.01 }, "demo-track.wav": 52, "voice-memo.m4a": 3 },
  code: {
    storefront: {
      src: { components: { "Cart.tsx": 0.01, "Header.tsx": 0.01, "ProductCard.tsx": 0.01 }, "app.tsx": 0.01, "api.ts": 0.01 },
      public: { "logo.svg": 0.01, "hero.webp": 0.4 },
      node_modules: { react: { "index.js": 0.01 }, next: { "index.js": 0.01 }, typescript: { "lib.d.ts": 0.2 } },
      ".next": { cache: { "webpack.pack": 120 } },
      logs: { "server.log": 48 },
      "package.json": 0.01,
      "README.md": 0.01,
    },
    "motion-graphics": { src: { "scene.ts": 0.02, "shaders.glsl": 0.01 }, node_modules: { three: { "index.js": 0.6 } }, "package.json": 0.01 },
    "video-engine": { src: { "encoder.rs": 0.04, "main.rs": 0.01 }, node_modules: { ffmpeg: { "index.js": 0.2 } }, "Cargo.toml": 0.01 },
    "forecast-model": {
      ".venv312": { Lib: { "site-packages": { torch: { "__init__.py": 0.01 } } } },
      __pycache__: { "model.cpython-312.pyc": 0.02 },
      notebooks: { "explore.ipynb": 2.1, "train.ipynb": 1.6 },
      data: { "sales.csv": 84, "weather.parquet": 120 },
      "model.py": 0.03,
      "requirements.txt": 0.01,
    },
  },
  OneDrive: { Documents: { "shared-plan.docx": 0.6 }, Pictures: { "phone-backup.jpg": 3.3 } },
  AppData: { Local: { Temp: { "tmp4a1c.tmp": 12 }, pip: { cache: { "wheels.bin": 900 } }, "npm-cache": { "_cacache.bin": 700 } }, Roaming: { Code: { "settings.json": 0.01 } } },
  ".vscode": { "extensions.json": 0.01 },
  ".gitconfig": 0.001,
};

const FLAGS: Record<string, Verdict> = {
  "Downloads\\Unconfirmed 633898.crdownload": "remove",
  "Downloads\\blender-5.1.2-windows-x64 (1).msi": "remove",
  "Downloads\\screen-recording-0918 (1).mp4": "remove",
  "Downloads\\DaVinci_Resolve_21.0.3_Windows.exe": "review",
  "Downloads\\nvidia-driver-610.88-win11.exe": "review",
  "Downloads\\trip-photos.zip": "review",
  "Pictures\\Backup\\dinner.jpg": "review",
  "code\\storefront\\node_modules": "remove",
  "code\\storefront\\.next": "remove",
  "code\\storefront\\logs\\server.log": "review",
  "code\\motion-graphics\\node_modules": "remove",
  "code\\video-engine\\node_modules": "remove",
  "code\\forecast-model\\.venv312": "review",
  "code\\forecast-model\\__pycache__": "remove",
  "AppData\\Local\\pip\\cache": "remove",
  "AppData\\Local\\npm-cache": "remove",
};

const HEAVY = new Set(["node_modules", ".next", ".venv312", "__pycache__", ".git"]);
const CATEGORY: Record<string, string> = {
  jpg: "images", png: "images", heic: "images", webp: "images", svg: "images",
  mp4: "videos", mov: "videos", mkv: "videos", wav: "audio", m4a: "audio", m3u: "audio",
  pdf: "documents", docx: "documents", md: "documents", txt: "documents", pptx: "presentations", xlsx: "spreadsheets", csv: "spreadsheets",
  zip: "archives", "7z": "archives", exe: "installers", msi: "installers",
  ts: "code", tsx: "code", js: "code", py: "code", rs: "code", glsl: "code", json: "code", html: "code", css: "code", toml: "code", ipynb: "code",
};

function specAt(rel: string): Spec | null {
  let node: Spec | number = TREE;
  for (const part of rel.split("\\").filter(Boolean)) {
    if (typeof node === "number") return null;
    node = node[part];
    if (node === undefined) return null;
  }
  return typeof node === "number" ? null : node;
}

function level(dir: string, maxDirs = 40, maxFiles = 24): GraphNode[] {
  const rel = dir.slice(HOME.length).replace(/^\\/, "");
  const spec = specAt(rel) ?? {};
  const dirs: GraphNode[] = [];
  const files: GraphNode[] = [];
  for (const [name, value] of Object.entries(spec)) {
    const path = `${dir}\\${name}`;
    const key = rel ? `${rel}\\${name}` : name;
    if (typeof value === "number") {
      const ext = name.split(".").pop()?.toLowerCase() ?? "";
      files.push({ kind: "file", path, name, size: Math.round(value * MB), category: CATEGORY[ext] ?? "other", hidden: name.startsWith(".") || undefined, flag: FLAGS[key] });
    } else {
      dirs.push({ kind: "dir", path, name, count: Object.keys(value).length, heavy: HEAVY.has(name) || undefined, hidden: name.startsWith(".") || name === "AppData" || undefined, flag: FLAGS[key] });
    }
  }
  dirs.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }));
  files.sort((a, b) => (b.size ?? 0) - (a.size ?? 0));
  const out = [...dirs.slice(0, maxDirs), ...files.slice(0, maxFiles)];
  const extra = dirs.length - Math.min(dirs.length, maxDirs) + files.length - Math.min(files.length, maxFiles);
  if (extra > 0) out.push({ kind: "more", path: `${dir}\\…`, name: `${extra} more`, dirs: Math.max(0, dirs.length - maxDirs), files: Math.max(0, files.length - maxFiles) });
  return out;
}

export const extraMock: Pick<
  CleanerApi,
  "organizePlaces" | "pickFolder" | "planOrganize" | "applyOrganize" | "organizeHistory" | "undoOrganize" | "graphLoad" | "graphExpand"
> = {
  async organizePlaces() {
    return [
      { id: "desktop", path: `${HOME}\\Desktop`, name: "Desktop", loose: 31 },
      { id: "downloads", path: `${HOME}\\Downloads`, name: "Downloads", loose: 9 },
      { id: "documents", path: `${HOME}\\Documents`, name: "Documents", loose: 3 },
      { id: "pictures", path: `${HOME}\\Pictures`, name: "Pictures", loose: 1 },
    ];
  },
  async pickFolder() {
    return `${HOME}\\Desktop`;
  },
  async planOrganize({ root }) {
    await wait(900);
    plan = makePlan(root);
    return { ok: true, plan };
  },
  async applyOrganize({ moves }) {
    await wait(700);
    const current = plan ?? makePlan(`${HOME}\\Desktop`);
    const sizes = new Map(current.files.map((f) => [f.id, f.size]));
    const isNew = new Map(current.moves.map((m) => [m.folder, m.isNew]));
    const folders = [...new Set(moves.map((m) => m.folder))];
    const run: OrganizeRun = {
      id: new Date().toISOString().replace(/[:.]/g, "-"),
      root: current.root,
      time: new Date().toISOString(),
      moved: moves.length,
      bytes: moves.reduce((s, m) => s + (sizes.get(m.id) ?? 0), 0),
      createdFolders: folders.filter((f) => isNew.get(f) ?? true).length,
      folders,
      failed: [],
      undoneAt: null,
      restored: null,
    };
    history = [run, ...history];
    plan = null;
    return { ok: true, run };
  },
  async organizeHistory() {
    return history;
  },
  async undoOrganize(id) {
    await wait(500);
    const run = history.find((r) => r.id === id);
    if (!run) throw new Error("that organize run is not in the history");
    const done = { ...run, undoneAt: new Date().toISOString(), restored: run.moved };
    history = history.map((r) => (r.id === id ? done : r));
    return { restored: run.moved, skipped: 0, run: done };
  },
  async graphLoad({ root }) {
    await wait(250);
    const children = level(root);
    for (const c of children) {
      if (c.kind !== "dir" || c.heavy || c.hidden || !c.count) continue;
      c.children = level(c.path, 4, 4);
      c.partial = true;
    }
    return { ok: true, tree: { kind: "dir", path: root, name: root.split("\\").pop() ?? root, count: children.length, children } };
  },
  async graphExpand(path) {
    await wait(120);
    return { children: level(path) };
  },
};
