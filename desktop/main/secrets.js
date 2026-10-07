import fs from "node:fs";
import path from "node:path";
import { safeStorage } from "electron";
import { DATA_DIR, loadEnv } from "./engine.js";

// The Gemini key is encrypted with Windows DPAPI through Electron's safeStorage,
// so only this Windows account on this machine can read it back.
const FILE = path.join(DATA_DIR, "gemini.key");

export function getKey() {
  if (fs.existsSync(FILE) && safeStorage.isEncryptionAvailable()) {
    try {
      return { key: safeStorage.decryptString(fs.readFileSync(FILE)), source: "secure" };
    } catch {
      // unreadable, for example after a Windows profile reset; fall through
    }
  }
  loadEnv(); // `cleaner setup` keeps the key in %LOCALAPPDATA%\cleaner\.env
  if (process.env.GEMINI_API_KEY) return { key: process.env.GEMINI_API_KEY, source: "cli" };
  return { key: null, source: null };
}

export function saveKey(key) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Windows secure storage is not available on this machine");
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, safeStorage.encryptString(key));
}

export function clearKey() {
  fs.rmSync(FILE, { force: true });
}

export function keyStatus() {
  const { key, source } = getKey();
  return { hasKey: Boolean(key), source, hint: key ? `${key.slice(0, 4)}…${key.slice(-4)}` : null };
}
