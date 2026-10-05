#!/usr/bin/env node
import { spawnSync } from "node:child_process";

// HTTPS scanners such as Avast re-sign TLS traffic, so Node has to trust the Windows certificate store.
const flag = "--use-system-ca";
if (process.allowedNodeEnvironmentFlags.has(flag) && !process.execArgv.includes(flag) && !process.env.CLEANER_RELAUNCHED) {
  const child = spawnSync(process.execPath, [flag, ...process.execArgv, ...process.argv.slice(1)], {
    stdio: "inherit",
    env: { ...process.env, CLEANER_RELAUNCHED: "1" },
  });
  process.exit(child.status ?? 1);
}

const { main } = await import("../src/cli.js");
try {
  await main(process.argv.slice(2));
} catch (err) {
  console.error(`\ncleaner: ${err.message}`);
  process.exitCode = 1;
}
