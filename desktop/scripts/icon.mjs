// Renders the Cleaner mark to build/icon.png (512x512) with Electron, so the icon always matches the logo.
// Run: node_modules/electron/dist/electron.exe scripts/icon.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow } from "electron";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "..", "build", "icon.png");
const SIZE = 512;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 32 32">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1b2a21"/><stop offset="1" stop-color="#0c130f"/></linearGradient></defs>
  <rect width="32" height="32" rx="7" fill="url(#bg)"/>
  <rect x="0.25" y="0.25" width="31.5" height="31.5" rx="6.8" fill="none" stroke="rgba(214,255,228,.16)" stroke-width="0.5"/>
  <path d="M8.4 21.6a8.6 8.6 0 1 1 15.2 0" fill="none" stroke="#2c3a31" stroke-width="2.6" stroke-linecap="round"/>
  <path d="M17.6 7.55a8.6 8.6 0 0 1 6 14.05" fill="none" stroke="#4fe08f" stroke-width="2.6" stroke-linecap="round"/>
  <path d="M16 17.2 21 11.8" stroke="#e8eee9" stroke-width="2.2" stroke-linecap="round"/>
  <circle cx="16" cy="17.4" r="2.1" fill="#e8eee9"/>
</svg>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: SIZE, height: SIZE, show: false, frame: false, transparent: true, useContentSize: true, webPreferences: { offscreen: true } });
  await win.loadURL(`data:text/html,${encodeURIComponent(`<style>html,body{margin:0;background:transparent;overflow:hidden}</style>${svg}`)}`);
  await new Promise((r) => setTimeout(r, 300));
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: SIZE, height: SIZE });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, image.resize({ width: SIZE, height: SIZE }).toPNG());
  console.log("wrote", out, image.getSize());
  app.quit();
});
