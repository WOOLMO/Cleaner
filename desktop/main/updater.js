import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import updater from "electron-updater";
import { readSettings } from "./settings.js";
import { log } from "./log.js";

// Updates come from the project's GitHub releases. electron-updater checks the installer's SHA-512
// against latest.yml from the same release before running it.
// The installed app downloads in the background and installs when it closes (or on "Restart now").
// The zip copy has no installer to update itself with, so it only says a new version is out.

const { autoUpdater } = updater;
const EVERY = 6 * 60 * 60 * 1000;
export const RELEASES_URL = "https://github.com/WOOLMO/Cleaner/releases/latest";

let state = { enabled: false, selfInstall: false, status: "idle", version: null, percent: null, error: null, checkedAt: null };
let notify = () => {};
const set = (patch) => {
  state = { ...state, ...patch };
  notify(state);
};
// electron-updater's errors carry whole HTTP responses; the window gets one plain sentence
const short = (err) => {
  const text = String(err?.message ?? err);
  if (/ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET|ERR_NETWORK_CHANGED/.test(text)) return "GitHub could not be reached. Are you offline?";
  if (/Unable to find latest version|No published versions/i.test(text)) return "No release has been published yet.";
  if (/sha512 checksum mismatch/i.test(text)) return "The download did not match its published checksum, so it was thrown away.";
  if (/HttpError: (403|429)/.test(text)) return "GitHub is limiting requests right now. It will try again later.";
  return text.split("\n")[0].replace(/^(Error: )+/, "").slice(0, 160);
};

export const updateState = () => state;

export function startUpdater({ onState }) {
  notify = onState;
  if (!app.isPackaged) return;
  // NSIS writes its uninstaller next to the app; the zip copy has none
  const selfInstall = fs.existsSync(path.join(path.dirname(process.execPath), `Uninstall ${app.getName()}.exe`));
  set({ enabled: true, selfInstall });
  autoUpdater.logger = { info: (m) => log.info(`update: ${m}`), warn: (m) => log.warn(`update: ${m}`), error: (m) => log.error(`update: ${m}`), debug: () => {} };
  autoUpdater.autoDownload = selfInstall;
  autoUpdater.autoInstallOnAppQuit = selfInstall;
  autoUpdater.allowPrerelease = false;
  autoUpdater.on("checking-for-update", () => set({ status: "checking", error: null }));
  autoUpdater.on("update-not-available", () => set({ status: "current", checkedAt: new Date().toISOString() }));
  autoUpdater.on("update-available", (info) => set({ status: selfInstall ? "downloading" : "available", version: info.version, percent: 0, checkedAt: new Date().toISOString() }));
  autoUpdater.on("download-progress", (p) => set({ status: "downloading", percent: Math.round(p.percent) }));
  autoUpdater.on("update-downloaded", (info) => set({ status: "ready", version: info.version, percent: 100 }));
  autoUpdater.on("error", (err) => set({ status: "error", error: short(err) }));

  const scheduled = () => {
    if (readSettings().autoUpdate) checkForUpdates();
  };
  setTimeout(scheduled, 20_000);
  setInterval(scheduled, EVERY);
}

export async function checkForUpdates() {
  if (!state.enabled || state.status === "downloading" || state.status === "ready") return state;
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    set({ status: "error", error: short(err) });
  }
  return state;
}

// Closes the app, runs the downloaded installer silently, and starts the new version.
export function installUpdate() {
  if (state.status !== "ready") return false;
  log.info(`installing update ${state.version}`);
  setImmediate(() => autoUpdater.quitAndInstall(true, true));
  return true;
}
