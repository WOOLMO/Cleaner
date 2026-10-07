import fs from "node:fs";
import path from "node:path";

// Organization policy, set by IT in C:\ProgramData\Cleaner\policy.json. It overrides user settings in the CLI
// and the desktop app alike. Example:
// {
//   "organization": "Contoso IT",
//   "aiEnabled": false,
//   "allowPreviews": false,
//   "allowPermanentDelete": false,
//   "maxAiItems": 200,
//   "excludePaths": ["C:\\Users\\*\\Documents\\Finance"]
// }
export const POLICY_FILE = process.env.CLEANER_POLICY
  || path.join(process.env.ProgramData || "C:\\ProgramData", "Cleaner", "policy.json");

const UNMANAGED = { managed: false, organization: null, excludePaths: [], error: null, source: POLICY_FILE };

export function loadPolicy() {
  if (!fs.existsSync(POLICY_FILE)) return { ...UNMANAGED };
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(POLICY_FILE, "utf8").replace(/^\uFEFF/, ""));
  } catch (err) {
    // A policy file that can't be read fails closed: the most restrictive settings apply.
    return {
      managed: true, organization: null, source: POLICY_FILE, error: `policy file unreadable: ${err.message}`,
      aiEnabled: false, allowPreviews: false, allowPermanentDelete: false, excludePaths: [],
    };
  }
  const bool = (v) => (typeof v === "boolean" ? v : undefined);
  return {
    managed: true,
    organization: typeof raw.organization === "string" ? raw.organization : null,
    aiEnabled: bool(raw.aiEnabled),
    allowPreviews: bool(raw.allowPreviews),
    allowPermanentDelete: bool(raw.allowPermanentDelete),
    maxAiItems: Number.isInteger(raw.maxAiItems) && raw.maxAiItems >= 0 ? raw.maxAiItems : undefined,
    excludePaths: Array.isArray(raw.excludePaths) ? raw.excludePaths.filter((p) => typeof p === "string") : [],
    // a file of SHA-256 hashes (one per line, optional name after it) the threat scan treats as known malware
    blocklistFile: typeof raw.blocklistFile === "string" ? raw.blocklistFile : null,
    error: null,
    source: POLICY_FILE,
  };
}

// excludePaths may use * for one folder level, for example C:\Users\*\Documents\Finance.
export function policyExcludes(policy) {
  return (policy.excludePaths ?? []).map((p) => {
    const pattern = p.replace(/[\\/]+$/, "").replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^\\\\]+");
    return new RegExp(`^${pattern}(\\\\|$)`, "i");
  });
}

export function isExcludedByPolicy(policy, target) {
  return policyExcludes(policy).some((re) => re.test(path.resolve(target)));
}
