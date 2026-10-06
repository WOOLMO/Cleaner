#!/usr/bin/env node
import { spawnSync } from "node:child_process";

// Relaunch once with two settings that must be in place before Node starts:
// --use-system-ca, because HTTPS scanners such as Avast re-sign TLS traffic, and a bigger
// libuv thread pool, because file metadata calls run there and the disk walk is ~5x faster with 16 threads.
const flag = "--use-system-ca";
if (!process.env.CLEANER_RELAUNCHED) {
  const nodeArgs = [...process.execArgv];
  if (process.allowedNodeEnvironmentFlags.has(flag) && !nodeArgs.includes(flag)) nodeArgs.unshift(flag);
  const child = spawnSync(process.execPath, [...nodeArgs, ...process.argv.slice(1)], {
    stdio: "inherit",
    env: { ...process.env, CLEANER_RELAUNCHED: "1", UV_THREADPOOL_SIZE: process.env.UV_THREADPOOL_SIZE || "16" },
  });
  process.exit(child.status ?? 1);
}

const { main } = await import("../src/cli.js");
await main(process.argv.slice(2));
