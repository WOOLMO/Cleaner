import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, DEFAULTS, loadPolicy } from "./engine.js";

const FILE = path.join(DATA_DIR, "settings.json");

export const DEFAULT_SETTINGS = {
  theme: "system",
  aiEnabled: true,
  previews: true,
  maxAi: DEFAULTS.maxAi,
  largeMB: DEFAULTS.largeFileMB,
  exclude: [],
  targets: [],
  watch: true,
  autoUpdate: true,
  welcomed: false,
};

const isAbsoluteList = (v) => Array.isArray(v) && v.length <= 200 && v.every((p) => typeof p === "string" && path.isAbsolute(p));
const RULES = {
  theme: (v) => ["system", "dark", "light"].includes(v),
  aiEnabled: (v) => typeof v === "boolean",
  previews: (v) => typeof v === "boolean",
  maxAi: (v) => Number.isInteger(v) && v >= 0 && v <= 2000,
  largeMB: (v) => Number.isInteger(v) && v >= 10 && v <= 100_000,
  exclude: isAbsoluteList,
  targets: isAbsoluteList,
  watch: (v) => typeof v === "boolean",
  autoUpdate: (v) => typeof v === "boolean",
  welcomed: (v) => typeof v === "boolean",
};

// Unknown keys and invalid values are dropped, never stored.
function sanitize(input) {
  const out = {};
  if (!input || typeof input !== "object") return out;
  for (const [key, valid] of Object.entries(RULES)) if (key in input && valid(input[key])) out[key] = input[key];
  return out;
}

export function readSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...sanitize(JSON.parse(fs.readFileSync(FILE, "utf8"))) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function writeSettings(patch) {
  const clean = sanitize(patch);
  const next = { ...readSettings(), ...clean };
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(next, null, 2), "utf8");
  return { next, changed: Object.keys(clean) };
}

// What actually applies once the organization policy is taken into account, and which settings it locks.
export function effectiveSettings() {
  const settings = readSettings();
  const policy = loadPolicy();
  const locks = {};
  if (policy.managed) {
    if (policy.aiEnabled === false) {
      settings.aiEnabled = false;
      locks.aiEnabled = true;
    }
    if (policy.allowPreviews === false) {
      settings.previews = false;
      locks.previews = true;
    }
    if (policy.maxAiItems !== undefined) {
      settings.maxAi = Math.min(settings.maxAi, policy.maxAiItems);
      locks.maxAi = true;
    }
  }
  return { settings, locks, policy, allowPermanentDelete: !(policy.managed && policy.allowPermanentDelete === false) };
}
