import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, ipcMain, Menu, nativeTheme, session, shell } from "electron";
import { registerIpc } from "./ipc.js";
import { readSettings } from "./settings.js";
import { log } from "./log.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const DEV_URL = process.env.VITE_DEV_SERVER_URL;
const DEMO = process.argv.includes("--demo") || process.env.CLEANER_DEMO === "1";
const CAPTURE_DIR = process.env.CLEANER_CAPTURE_DIR;

app.setAppUserModelId("io.github.woolmo.cleaner");
// Screenshot mode runs beside a real window: its own browser profile, and no single-instance lock.
if (CAPTURE_DIR) app.setPath("userData", path.join(app.getPath("temp"), "cleaner-capture-profile"));
else if (!app.requestSingleInstanceLock()) app.quit();

const DARK = { bg: "#0b0e0c", symbols: "#c3ccc6" };
const LIGHT = { bg: "#f4f6f4", symbols: "#2b322e" };

let win = null;

function createWindow() {
  const theme = readSettings().theme;
  const dark = theme === "dark" || (theme === "system" && nativeTheme.shouldUseDarkColors);
  const palette = dark ? DARK : LIGHT;
  win = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 1080,
    minHeight: 700,
    show: false,
    title: "Cleaner",
    backgroundColor: palette.bg,
    titleBarStyle: "hidden",
    titleBarOverlay: { color: palette.bg, symbolColor: palette.symbols, height: 46 },
    icon: path.join(here, "..", "build", "icon.png"),
    webPreferences: {
      preload: path.join(here, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      devTools: !app.isPackaged,
      additionalArguments: [...(DEMO ? ["--cleaner-demo"] : []), ...(CAPTURE_DIR ? ["--cleaner-capture"] : [])],
    },
  });

  win.once("ready-to-show", () => {
    if (!CAPTURE_DIR) win.show();
  });

  // The app never navigates away or opens windows. Links to the project page open in the browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://github.com/WOOLMO/Cleaner")) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault();
  });

  if (DEV_URL) win.loadURL(DEV_URL);
  else win.loadFile(path.join(here, "..", "renderer", "dist", "index.html"));

  if (CAPTURE_DIR) win.webContents.once("did-finish-load", () => capture());
}

// Screenshot mode for the README: visits each page and saves a PNG. Used with --demo, so no real data appears.
async function capture() {
  // "page" or "page:ms" to wait longer before the shot
  const pages = (process.env.CLEANER_CAPTURE_PAGES ?? "overview,scan,results,detail,confirm,protect,protect-detail,protect-startup,organize,organize-plan:2400,map,graph:2600,graph-open:3600,network:3200,holding,activity,settings,palette,running").split(",");
  fs.mkdirSync(CAPTURE_DIR, { recursive: true });
  win.setContentSize(1360, 860);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await wait(1200);
  for (const item of pages) {
    const [page, ms] = item.split(":");
    win.webContents.send("capture:navigate", page);
    await wait(Number(ms) || 1600);
    const image = await win.webContents.capturePage();
    fs.writeFileSync(path.join(CAPTURE_DIR, `${page}.png`), image.toPNG());
    log.info("captured", page);
  }
  app.quit();
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  if (CAPTURE_DIR && ["dark", "light"].includes(process.env.CLEANER_CAPTURE_THEME)) nativeTheme.themeSource = process.env.CLEANER_CAPTURE_THEME;
  // No permission (camera, notifications, geolocation...) is ever granted to the window.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));

  registerIpc();
  ipcMain.on("window:titlebar", (event, colors) => {
    const w = BrowserWindow.fromWebContents(event.sender);
    if (w && colors && typeof colors.color === "string" && typeof colors.symbolColor === "string") {
      try {
        w.setTitleBarOverlay({ color: colors.color, symbolColor: colors.symbolColor, height: 46 });
      } catch {
        // not supported on this platform
      }
    }
  });

  log.info(`Cleaner ${app.getVersion()} starting${DEMO ? " in demo mode" : ""}`);
  createWindow();
});

app.on("second-instance", () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.on("window-all-closed", () => app.quit());
