import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./config.js";

// The organizer tidies the loose files of one folder (Desktop, Downloads...) into folders that follow the
// owner's own system: their existing folders first, new ones named in their language and naming style.
// It only ever moves files that sit directly in that folder, never folders, and every run can be undone.

const MINUTE = 60_000;
export const JOURNAL_DIR = path.join(DATA_DIR, "organize");

export const CATEGORIES = {
  documents: ["pdf", "doc", "docx", "odt", "rtf", "txt", "md", "pages", "tex"],
  spreadsheets: ["xls", "xlsx", "ods", "csv", "tsv", "numbers"],
  presentations: ["ppt", "pptx", "odp", "key"],
  images: ["jpg", "jpeg", "png", "gif", "webp", "heic", "heif", "bmp", "tif", "tiff", "svg", "avif", "cr2", "nef", "arw", "dng"],
  videos: ["mp4", "mov", "mkv", "avi", "webm", "wmv", "m4v", "flv", "mpg", "mpeg"],
  audio: ["mp3", "wav", "flac", "m4a", "aac", "ogg", "opus", "wma"],
  archives: ["zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz"],
  installers: ["exe", "msi", "msix", "msixbundle", "appx", "apk", "xapk", "dmg", "pkg"],
  "disk-images": ["iso", "img", "vhd", "vhdx", "vmdk"],
  code: ["js", "mjs", "cjs", "ts", "tsx", "jsx", "py", "ipynb", "java", "c", "cpp", "h", "hpp", "cs", "go", "rs", "rb", "php", "html", "css", "scss", "sql", "sh", "ps1", "kt", "swift", "lua", "r", "json", "yaml", "yml"],
  design: ["psd", "ai", "fig", "sketch", "xd", "indd", "afdesign", "afphoto", "kra", "xcf"],
  "3d": ["blend", "fbx", "obj", "stl", "3mf", "glb", "gltf", "max", "ma", "mb", "c4d"],
  fonts: ["ttf", "otf", "woff", "woff2"],
  ebooks: ["epub", "mobi", "azw", "azw3", "djvu", "cbz", "cbr"],
};
const EXT_TO_CATEGORY = new Map(Object.entries(CATEGORIES).flatMap(([cat, exts]) => exts.map((e) => [e, cat])));
const SCREENSHOT_NAME = /screen ?shot|capture d.?[ée]cran|captura|bildschirmfoto|schermafbeelding|snip|screen recording/i;

// Folder names for new folders, in the natural form of each language.
export const NAMES = {
  en: { documents: "Documents", spreadsheets: "Spreadsheets", presentations: "Presentations", images: "Images", screenshots: "Screenshots", videos: "Videos", audio: "Music", archives: "Archives", installers: "Installers", "disk-images": "Disk Images", code: "Code", design: "Design", "3d": "3D Models", fonts: "Fonts", ebooks: "Ebooks" },
  fr: { documents: "Documents", spreadsheets: "Tableurs", presentations: "Présentations", images: "Images", screenshots: "Captures d'écran", videos: "Vidéos", audio: "Musique", archives: "Archives", installers: "Installateurs", "disk-images": "Images disque", code: "Code", design: "Design", "3d": "Modèles 3D", fonts: "Polices", ebooks: "Livres numériques" },
  es: { documents: "Documentos", spreadsheets: "Hojas de cálculo", presentations: "Presentaciones", images: "Imágenes", screenshots: "Capturas de pantalla", videos: "Vídeos", audio: "Música", archives: "Archivos comprimidos", installers: "Instaladores", "disk-images": "Imágenes de disco", code: "Código", design: "Diseño", "3d": "Modelos 3D", fonts: "Fuentes", ebooks: "Libros electrónicos" },
  de: { documents: "Dokumente", spreadsheets: "Tabellen", presentations: "Präsentationen", images: "Bilder", screenshots: "Bildschirmfotos", videos: "Videos", audio: "Musik", archives: "Archive", installers: "Installationsprogramme", "disk-images": "Datenträgerabbilder", code: "Code", design: "Design", "3d": "3D-Modelle", fonts: "Schriftarten", ebooks: "E-Books" },
  it: { documents: "Documenti", spreadsheets: "Fogli di calcolo", presentations: "Presentazioni", images: "Immagini", screenshots: "Screenshot", videos: "Video", audio: "Musica", archives: "Archivi", installers: "Programmi di installazione", "disk-images": "Immagini disco", code: "Codice", design: "Design", "3d": "Modelli 3D", fonts: "Font", ebooks: "Ebook" },
  pt: { documents: "Documentos", spreadsheets: "Planilhas", presentations: "Apresentações", images: "Imagens", screenshots: "Capturas de tela", videos: "Vídeos", audio: "Música", archives: "Arquivos compactados", installers: "Instaladores", "disk-images": "Imagens de disco", code: "Código", design: "Design", "3d": "Modelos 3D", fonts: "Fontes", ebooks: "E-books" },
  nl: { documents: "Documenten", spreadsheets: "Spreadsheets", presentations: "Presentaties", images: "Afbeeldingen", screenshots: "Schermafbeeldingen", videos: "Video's", audio: "Muziek", archives: "Archieven", installers: "Installatieprogramma's", "disk-images": "Schijfkopieën", code: "Code", design: "Ontwerp", "3d": "3D-modellen", fonts: "Lettertypen", ebooks: "E-books" },
  ar: { documents: "مستندات", spreadsheets: "جداول بيانات", presentations: "عروض تقديمية", images: "صور", screenshots: "لقطات الشاشة", videos: "فيديوهات", audio: "موسيقى", archives: "ملفات مضغوطة", installers: "برامج التثبيت", "disk-images": "صور الأقراص", code: "برمجة", design: "تصميم", "3d": "نماذج ثلاثية الأبعاد", fonts: "خطوط", ebooks: "كتب إلكترونية" },
};
export const LANGUAGE_NAMES = { en: "English", fr: "French", es: "Spanish", de: "German", it: "Italian", pt: "Portuguese", nl: "Dutch", ar: "Arabic" };

// Words people use in folder names, per language. Used to tell which language someone organizes in.
const LANG_WORDS = {
  en: ["new folder", "projects", "project", "work", "games", "important", "later", "business", "personal", "school", "apps", "old", "stuff", "misc", "videos", "channel", "coding", "music", "pictures", "photos", "downloads", "installers", "archives", "backup", "files", "screenshots", "and", "the", "my"],
  fr: ["nouveau dossier", "projets", "projet", "travail", "jeux", "perso", "personnel", "cours", "factures", "important", "ancien", "divers", "vidéos", "musique", "téléchargements", "dossier", "photos", "images", "fichiers", "logiciels", "et", "les", "mes", "captures", "sauvegarde"],
  es: ["nueva carpeta", "proyectos", "trabajo", "juegos", "personal", "escuela", "facturas", "varios", "música", "vídeos", "descargas", "fotos", "imágenes", "archivos", "programas", "y", "mis"],
  de: ["neuer ordner", "projekte", "arbeit", "spiele", "schule", "rechnungen", "sonstiges", "musik", "bilder", "dokumente", "dateien", "programme", "und", "meine"],
  it: ["nuova cartella", "progetti", "lavoro", "giochi", "scuola", "fatture", "varie", "musica", "immagini", "documenti", "file", "programmi", "e", "miei"],
  pt: ["nova pasta", "projetos", "trabalho", "jogos", "escola", "faturas", "diversos", "música", "imagens", "arquivos", "programas", "e", "meus"],
  nl: ["nieuwe map", "projecten", "werk", "spellen", "school", "facturen", "overig", "muziek", "afbeeldingen", "bestanden", "programma's", "en", "mijn"],
};

// Which existing folder names point to which kind of file, in any language.
const FOLDER_HINTS = {
  installers: ["install", "setup", "apps", "logiciel", "software", "instalador", "programm", "application"],
  images: ["image", "photo", "picture", "pics", "wallpaper", "fond", "imagen", "foto", "bilder", "immagin", "afbeelding", "صور"],
  screenshots: ["screenshot", "capture", "captura", "bildschirm", "schermafbeelding", "لقطات"],
  videos: ["video", "vidéo", "vídeo", "film", "movie", "recording", "clip", "enregistrement", "فيديو"],
  audio: ["music", "musique", "música", "musik", "musica", "muziek", "audio", "song", "sound", "podcast", "voiceover", "موسيقى"],
  documents: ["document", "docs", "pdf", "papers", "documento", "dokument", "documenti", "documenten", "مستندات"],
  spreadsheets: ["sheet", "excel", "tableur", "tabelle", "planilha", "hoja"],
  presentations: ["presentation", "présentation", "slides", "deck", "diapo", "presentacion"],
  archives: ["archive", "zip", "compress", "rar"],
  "disk-images": ["iso", "disk image", "image disque"],
  code: ["code", "coding", "dev", "script", "programming", "projet", "project", "código", "codice"],
  design: ["design", "figma", "asset", "graphic", "mockup", "diseño", "ontwerp"],
  "3d": ["3d", "blender", "model"],
  fonts: ["font", "police", "fuente", "schrift", "lettertype"],
  ebooks: ["book", "livre", "ebook", "libro", "lecture", "buch"],
};

const PROJECT_MARKERS = new Set(["package.json", "pyproject.toml", "requirements.txt", "cargo.toml", "go.mod", "pom.xml", ".git"]);
const NEVER_MOVE_EXT = new Set(["lnk", "url", "ini", "crdownload", "part", "partial", "download", "tmp", "temp", "sys", "dll"]);
const SKIP_FOLDERS = /^(\$recycle\.bin|system volume information|node_modules|\.git|__pycache__)$/i;

const fold = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const extOf = (name) => path.extname(name).slice(1).toLowerCase();

export function categoryOf(name) {
  const ext = extOf(name);
  const cat = EXT_TO_CATEGORY.get(ext) ?? null;
  if (cat === "images" && SCREENSHOT_NAME.test(name)) return "screenshots";
  return cat;
}

// ---------- style ----------
function stripNumber(name) {
  return name.replace(/^\d{1,3}[\s._-]+/, "");
}

export function caseOf(raw) {
  const name = stripNumber(raw).trim();
  if (!/[a-zA-Z]/.test(name)) return "other";
  if (/_/.test(name) && name === name.toLowerCase() && !/\s/.test(name)) return "snake";
  if (/-/.test(name) && name === name.toLowerCase() && !/\s/.test(name)) return "kebab";
  if (!/\s/.test(name) && /^[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]+)+$/.test(name)) return "pascal";
  if (name === name.toUpperCase() && name.length > 2) return "upper";
  if (name === name.toLowerCase()) return "lower";
  const words = name.split(/\s+/).filter((w) => /^[a-zA-Z]/.test(w));
  if (words.length < 2) return "capitalized";
  const long = words.filter((w) => w.length > 3);
  if (long.length && long.every((w) => /^[A-Z]/.test(w))) return "title";
  if (/^[A-Z]/.test(words[0]) && words.slice(1).every((w) => /^[a-z]/.test(w))) return "sentence";
  return "mixed";
}

export function detectLanguage(names, systemLocale = "") {
  const scores = Object.fromEntries(Object.keys(NAMES).map((l) => [l, 0]));
  for (const raw of names) {
    const name = stripNumber(raw).toLowerCase();
    if (/[؀-ۿ]/.test(name)) scores.ar += 3;
    if (/[éèêàçùôî]/.test(name)) scores.fr += 0.5;
    if (/[ñ¿¡]/.test(name)) scores.es += 1;
    if (/[äöüß]/.test(name)) scores.de += 1;
    const words = name.split(/[\s_\-.,()]+/).filter(Boolean);
    for (const [lang, list] of Object.entries(LANG_WORDS)) {
      for (const w of list) {
        if (w.includes(" ") ? name.includes(w) : words.includes(w)) scores[lang] += w.includes(" ") ? 2 : 1;
      }
    }
  }
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [best, second] = ranked;
  const system = String(systemLocale).slice(0, 2).toLowerCase();
  if (best[1] >= 2 && best[1] - second[1] >= 1) return { language: best[0], source: "folders" };
  if (NAMES[system]) return { language: system, source: "system" };
  return { language: "en", source: "default" };
}

export function detectStyle(folderNames, systemLocale = "") {
  const names = folderNames.filter((n) => !n.startsWith(".") && !SKIP_FOLDERS.test(n));
  const { language, source } = detectLanguage(names, systemLocale);
  const tally = {};
  for (const n of names) {
    const c = caseOf(n);
    tally[c] = (tally[c] ?? 0) + 1;
  }
  const decisive = Object.entries(tally).filter(([c]) => !["capitalized", "other", "mixed"].includes(c)).sort((a, b) => b[1] - a[1]);
  let casing = decisive[0]?.[0] ?? (tally.capitalized ? "title" : "natural");
  if (decisive[0] && decisive[0][1] < Math.max(2, names.length * 0.4)) casing = tally.capitalized >= decisive[0][1] ? "title" : casing;
  const numbered = names.filter((n) => /^\d{1,3}[\s._-]+/.test(n));
  const numbering = numbered.length >= 2 && numbered.length >= names.length * 0.6
    ? { width: Math.max(...numbered.map((n) => n.match(/^\d+/)[0].length)), separator: numbered[0].match(/^\d+([\s._-]+)/)[1], next: Math.max(...numbered.map((n) => Number(n.match(/^\d+/)[0]))) + 1 }
    : null;
  const detected = names.length >= 2 && (source === "folders" || decisive.length > 0);
  return { language, languageSource: source, casing, numbering, detected, sampleNames: names.slice(0, 12) };
}

export function styleName(category, style, taken = new Set()) {
  let name = (NAMES[style.language] ?? NAMES.en)[category];
  switch (style.casing) {
    case "lower": name = name.toLowerCase(); break;
    case "upper": name = name.toUpperCase(); break;
    case "kebab": name = name.toLowerCase().replace(/['’]/g, "").replace(/\s+/g, "-"); break;
    case "snake": name = name.toLowerCase().replace(/['’]/g, "").replace(/\s+/g, "_"); break;
    case "pascal": name = name.replace(/['’]/g, " ").split(/\s+/).map((w) => w[0].toUpperCase() + w.slice(1)).join(""); break;
    case "title": if (style.language === "en") name = name.replace(/\b[a-z]/g, (c) => c.toUpperCase()); break;
    case "sentence": name = name[0].toUpperCase() + name.slice(1).toLowerCase(); break;
    default: break;
  }
  if (style.numbering) {
    const n = style.numbering.next + taken.size;
    name = `${String(n).padStart(style.numbering.width, "0")}${style.numbering.separator}${name}`;
  }
  return name;
}

// ---------- analysis ----------
function profileFolder(dir, limit = 400) {
  const counts = {};
  let files = 0;
  let project = false;
  const stack = [{ d: dir, depth: 0 }];
  while (stack.length && files < limit) {
    const { d, depth } = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (depth === 0 && PROJECT_MARKERS.has(e.name.toLowerCase())) project = true;
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        if (depth < 2 && !SKIP_FOLDERS.test(e.name) && !e.name.startsWith(".")) stack.push({ d: path.join(d, e.name), depth: depth + 1 });
      } else if (e.isFile()) {
        files++;
        const cat = categoryOf(e.name);
        if (cat) counts[cat] = (counts[cat] ?? 0) + 1;
      }
    }
  }
  const known = Object.values(counts).reduce((s, n) => s + n, 0);
  const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return { files, counts, project, dominant: ranked[0] && known >= 3 && ranked[0][1] / known >= 0.6 ? ranked[0][0] : null };
}

// A hint matches the start of a word, so "Wallpapers" is not a folder for papers.
function hintScore(name, category) {
  const n = fold(name);
  const words = n.split(/[\s_\-.,()&+]+/).filter(Boolean);
  return (FOLDER_HINTS[category] ?? []).some((h) => {
    const hint = fold(h);
    return hint.includes(" ") ? n.includes(hint) : words.some((w) => w.startsWith(hint));
  }) ? 1 : 0;
}

// Picks, for each kind of file, the owner's existing folder that already holds that kind or is named for it.
function findDestinations(folders) {
  const out = {};
  for (const category of Object.keys(NAMES.en)) {
    let best = null;
    for (const f of folders) {
      if (f.profile.project && category !== "code") continue;
      const share = f.profile.counts[category] ? f.profile.counts[category] / Math.max(1, Object.values(f.profile.counts).reduce((s, n) => s + n, 0)) : 0;
      const score = hintScore(f.name, category) * 1.5 + (f.profile.dominant === category ? 1.5 : share >= 0.4 ? share : 0);
      if (score >= 1 && (!best || score > best.score)) best = { name: f.name, score, why: f.profile.dominant === category ? "holds" : "named" };
    }
    if (best) out[category] = best;
  }
  // screenshots fall back to the images folder when there is no screenshots folder
  if (!out.screenshots && out.images) out.screenshots = { ...out.images, why: "images" };
  return out;
}

// Only personal folders are organized. Drive roots, Windows, programs, app data and code projects are refused.
const env = process.env;
const SYSTEM_DIRS = [env.SystemRoot ?? env.windir, env.ProgramFiles, env["ProgramFiles(x86)"], env.ProgramData, env.LOCALAPPDATA, env.APPDATA].filter(Boolean);

export function organizeBlocked(root, { systemDirs = SYSTEM_DIRS } = {}) {
  const p = path.resolve(root);
  const low = p.toLowerCase();
  if (!fs.existsSync(p) || !fs.statSync(p).isDirectory()) return "that folder does not exist";
  if (path.parse(p).root.toLowerCase() === low || path.parse(p).root.toLowerCase() === low + path.sep) return "a whole drive can't be organized, pick a folder";
  const system = systemDirs.map((d) => path.resolve(d).toLowerCase());
  if (system.some((d) => low === d || low.startsWith(d + path.sep))) return "system and program folders are never organized";
  if (low.split(path.sep).some((part) => part === "node_modules" || part === ".git")) return "app data is never organized";
  for (const marker of PROJECT_MARKERS) if (fs.existsSync(path.join(p, marker))) return "this looks like a code project, its files stay where its tools expect them";
  return null;
}

export function analyzeFolder(root, { systemLocale = "", now = Date.now() } = {}) {
  root = path.resolve(root);
  const entries = fs.readdirSync(root, { withFileTypes: true });
  const folders = [];
  const files = [];
  const skipped = [];
  for (const e of entries) {
    const p = path.join(root, e.name);
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) {
      if (SKIP_FOLDERS.test(e.name) || e.name.startsWith(".")) continue;
      folders.push({ name: e.name, path: p, profile: profileFolder(p) });
      continue;
    }
    if (!e.isFile()) continue;
    let st;
    try {
      st = fs.statSync(p);
    } catch {
      continue;
    }
    const ext = extOf(e.name);
    const reason = e.name.startsWith(".") || e.name.startsWith("~$") ? "hidden or lock file"
      : NEVER_MOVE_EXT.has(ext) ? (ext === "lnk" || ext === "url" ? "shortcut" : "system or in-progress file")
      : now - st.mtimeMs < 2 * MINUTE ? "changed in the last two minutes"
      : null;
    const item = { id: files.length + skipped.length + 1, name: e.name, path: p, size: st.size, mtime: st.mtimeMs, ext, category: categoryOf(e.name) };
    if (reason) skipped.push({ ...item, reason });
    else files.push(item);
  }
  const style = detectStyle(folders.map((f) => f.name), systemLocale);
  const destinations = findDestinations(folders);
  return { root, folders, files, skipped, style, destinations };
}

// ---------- planning ----------
// Words too common in file names to say anything about where a file belongs.
const NOISE = new Set(["copy", "copie", "final", "new", "nouveau", "untitled", "sans", "titre", "document", "image", "photo", "file", "fichier", "scan", "screenshot", "capture", "setup", "install", "version", "draft", "test", "temp", "download", "export", "backup", "with", "from", "pour", "dans", "avec", "this", "that"]);
function tokens(name) {
  return fold(name).split(/[^\p{L}]+/u).filter((w) => w.length >= 4 && !NOISE.has(w));
}
const sameWord = (a, b) => a === b || (a.length >= 5 && b.length >= 5 && (a.startsWith(b) || b.startsWith(a)));

// A file whose name shares a word with one of the owner's folders goes there: "facture-edf.pdf" to "Factures".
function affinityFolder(file, folders) {
  const words = tokens(path.parse(file.name).name);
  if (!words.length) return null;
  let best = null;
  for (const f of folders) {
    if (f.profile.project || (f.profile.dominant === "code" && file.category !== "code")) continue;
    const hits = tokens(f.name).filter((w) => words.some((x) => sameWord(w, x))).length;
    if (hits && (!best || hits > best.hits)) best = { name: f.name, hits };
  }
  return best?.name ?? null;
}

const KIND = {
  documents: "documents", spreadsheets: "spreadsheets", presentations: "presentations", images: "images", screenshots: "screenshots",
  videos: "videos", audio: "audio files", archives: "archives", installers: "installers", "disk-images": "disk images", code: "code files",
  design: "design files", "3d": "3D models", fonts: "fonts", ebooks: "ebooks",
};

export function rulePlan(analysis) {
  const newNames = new Map();
  const moves = [];
  const stay = [];
  for (const f of analysis.files) {
    const near = affinityFolder(f, analysis.folders);
    if (near) {
      moves.push({ id: f.id, folder: near, isNew: false, category: f.category, source: "rules", reason: `Its name matches your "${near}" folder` });
      continue;
    }
    if (!f.category) {
      stay.push({ ...f, reason: "No obvious place for this kind of file" });
      continue;
    }
    const dest = analysis.destinations[f.category];
    if (dest) {
      moves.push({ id: f.id, folder: dest.name, isNew: false, category: f.category, source: "rules", reason: dest.why === "holds" ? `"${dest.name}" already holds your ${KIND[f.category]}` : `"${dest.name}" is your folder for ${KIND[f.category]}` });
      continue;
    }
    if (!newNames.has(f.category)) newNames.set(f.category, styleName(f.category, analysis.style, new Set(newNames.values())));
    const name = newNames.get(f.category);
    const exists = analysis.folders.some((x) => x.name.toLowerCase() === name.toLowerCase());
    moves.push({ id: f.id, folder: name, isNew: !exists, category: f.category, source: "rules", reason: `${exists ? "" : "New "}"${name}" folder for ${KIND[f.category]}` });
  }
  return { moves, stay };
}

// Folder names must be a single, valid Windows name. Anything else is refused.
export function cleanFolderName(name) {
  if (typeof name !== "string") return null;
  const clean = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "").replace(/^[. ]+|[. ]+$/g, "").trim();
  if (!clean || clean.length > 60 || /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(clean) || clean === "." || clean === "..") return null;
  return clean;
}

export const ORGANIZE_PROMPT = `You organize the loose files of one folder on a Windows PC the way its owner would.
You get the owner's existing subfolders (with what they mostly hold), the detected naming language and style, and the loose files with a suggestion from simple rules.
For every file return one result with the same id:
- folder: the name of the folder it should go to. Prefer an existing folder whenever it fits, matching its name exactly. Otherwise invent a short new folder name in the owner's language and naming style (same casing and separators as their folders). Use "" to leave the file where it is.
- reason: one short plain sentence under 70 characters.
Rules: group by purpose when names make it obvious (invoices, school, a project, a game), otherwise by file type. Never put files into folders that are someone's code projects unless the file is code for that project. Keep the number of new folders small. Do not use slashes in folder names.`;

const ORGANIZE_SCHEMA = {
  type: "OBJECT",
  properties: {
    results: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { id: { type: "INTEGER" }, folder: { type: "STRING" }, reason: { type: "STRING" } },
        required: ["id", "folder", "reason"],
      },
    },
  },
  required: ["results"],
};

// Gemini sees file names, extensions, sizes and dates only, never file contents.
export async function aiPlan(analysis, base, { gemini, maxFiles = 300 }) {
  const files = analysis.files.slice(0, maxFiles);
  const suggestion = new Map(base.moves.map((m) => [m.id, m.folder]));
  const body = {
    systemInstruction: { parts: [{ text: ORGANIZE_PROMPT }] },
    contents: [{
      role: "user",
      parts: [{
        text: "Organize these files:\n" + JSON.stringify({
          language: LANGUAGE_NAMES[analysis.style.language],
          namingStyle: analysis.style.casing,
          numberedFolders: Boolean(analysis.style.numbering),
          existingFolders: analysis.folders.map((f) => ({ name: f.name, holds: f.profile.dominant ?? (Object.keys(f.profile.counts).slice(0, 3).join(", ") || "mixed"), codeProject: f.profile.project || undefined })),
          files: files.map((f) => ({ id: f.id, name: f.name, size: f.size, modified: new Date(f.mtime).toISOString().slice(0, 10), ruleSuggestion: suggestion.get(f.id) ?? "" })),
        }),
      }],
    }],
    generationConfig: { temperature: 0.2, responseMimeType: "application/json", responseSchema: ORGANIZE_SCHEMA },
  };
  const out = await gemini.generate(body);
  const existing = new Map(analysis.folders.map((f) => [f.name.toLowerCase(), f.name]));
  const byId = new Map(files.map((f) => [f.id, f]));
  const moves = [];
  const stay = [];
  const decided = new Set();
  for (const r of out.results ?? []) {
    const file = byId.get(r.id);
    if (!file || decided.has(r.id)) continue;
    decided.add(r.id);
    const reason = String(r.reason ?? "").slice(0, 120);
    if (!r.folder) {
      stay.push({ ...file, reason: reason || "Left where it is" });
      continue;
    }
    const clean = cleanFolderName(r.folder);
    if (!clean) continue; // invalid name: the rule plan below covers this file
    const match = existing.get(clean.toLowerCase());
    moves.push({ id: r.id, folder: match ?? clean, isNew: !match, category: file.category, source: "gemini", reason });
  }
  // Files Gemini skipped or named badly keep the rule plan.
  const covered = new Set([...moves, ...stay].map((x) => x.id));
  for (const m of base.moves) if (!covered.has(m.id)) moves.push(m);
  for (const s of base.stay) if (!covered.has(s.id)) stay.push(s);
  return { moves, stay };
}

// ---------- applying and undoing ----------
function freeName(dir, name) {
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  let candidate = name;
  for (let i = 2; fs.existsSync(path.join(dir, candidate)); i++) candidate = `${stem} (${i})${ext}`;
  return candidate;
}

// Moves files into place. Nothing is overwritten: a clash gets " (2)" like Explorer does.
// The journal records every move so the whole run can be undone.
export function applyPlan(analysis, moves) {
  const byId = new Map(analysis.files.map((f) => [f.id, f]));
  const journal = { id: new Date().toISOString().replace(/[:.]/g, "-"), root: analysis.root, time: new Date().toISOString(), moves: [], createdFolders: [], failed: [] };
  for (const m of moves) {
    const file = byId.get(m.id);
    const folder = cleanFolderName(m.folder);
    if (!file || !folder) continue;
    const dir = path.join(analysis.root, folder);
    if (path.dirname(dir) !== analysis.root) continue; // one level down, never anywhere else
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir);
        journal.createdFolders.push(dir);
      }
      const to = path.join(dir, freeName(dir, file.name));
      fs.renameSync(file.path, to);
      journal.moves.push({ from: file.path, to, size: file.size });
    } catch (err) {
      journal.failed.push({ path: file.path, reason: err.code === "EBUSY" || err.code === "EPERM" ? "in use" : err.code ?? err.message });
    }
  }
  fs.mkdirSync(JOURNAL_DIR, { recursive: true });
  fs.writeFileSync(path.join(JOURNAL_DIR, `${journal.id}.json`), JSON.stringify(journal, null, 2), "utf8");
  return journal;
}

export function listJournals() {
  if (!fs.existsSync(JOURNAL_DIR)) return [];
  return fs.readdirSync(JOURNAL_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(JOURNAL_DIR, f), "utf8"));
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.time.localeCompare(a.time));
}

export function undoOrganize(journalId) {
  const file = path.join(JOURNAL_DIR, `${String(journalId).replace(/[^\w-]/g, "")}.json`);
  if (!fs.existsSync(file)) throw new Error("that organize run is not in the history");
  const journal = JSON.parse(fs.readFileSync(file, "utf8"));
  const result = { restored: 0, skipped: [] };
  for (const m of [...journal.moves].reverse()) {
    if (!fs.existsSync(m.to)) {
      result.skipped.push({ path: m.from, reason: "moved or deleted since" });
      continue;
    }
    if (fs.existsSync(m.from)) {
      result.skipped.push({ path: m.from, reason: "a new file now has that name" });
      continue;
    }
    try {
      fs.renameSync(m.to, m.from);
      result.restored++;
    } catch (err) {
      result.skipped.push({ path: m.from, reason: err.code ?? err.message });
    }
  }
  for (const dir of journal.createdFolders) {
    try {
      if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
    } catch {
      // folder already gone or not empty: leave it
    }
  }
  journal.undoneAt = new Date().toISOString();
  journal.undo = result;
  fs.writeFileSync(file, JSON.stringify(journal, null, 2), "utf8");
  return { ...result, journal };
}
