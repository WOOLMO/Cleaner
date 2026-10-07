import fs from "node:fs";
import path from "node:path";
import { safeStorage } from "electron";
import { DATA_DIR, loadEnv } from "./engine.js";

// API keys are encrypted with Windows DPAPI through Electron's safeStorage,
// so only this Windows account on this machine can read them back.
// Each key falls back to the CLI's %LOCALAPPDATA%\cleaner\.env, so `cleaner setup` keys work here too.
export const KEYS = {
  gemini: { file: "gemini.key", env: "GEMINI_API_KEY" },
  malwareBazaar: { file: "malwarebazaar.key", env: "MALWAREBAZAAR_KEY" },
  virusTotal: { file: "virustotal.key", env: "VIRUSTOTAL_KEY" },
};

const fileOf = (name) => path.join(DATA_DIR, KEYS[name].file);

export function getKey(name = "gemini") {
  const file = fileOf(name);
  if (fs.existsSync(file) && safeStorage.isEncryptionAvailable()) {
    try {
      return { key: safeStorage.decryptString(fs.readFileSync(file)), source: "secure" };
    } catch {
      // unreadable, for example after a Windows profile reset; fall through
    }
  }
  loadEnv();
  const env = process.env[KEYS[name].env];
  if (env) return { key: env, source: "cli" };
  return { key: null, source: null };
}

export function saveKey(key, name = "gemini") {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Windows secure storage is not available on this machine");
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(fileOf(name), safeStorage.encryptString(key));
}

export function clearKey(name = "gemini") {
  fs.rmSync(fileOf(name), { force: true });
}

export function keyStatus(name = "gemini") {
  const { key, source } = getKey(name);
  return { hasKey: Boolean(key), source, hint: key ? `${key.slice(0, 4)}…${key.slice(-4)}` : null };
}
