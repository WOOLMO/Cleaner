// Development: Vite with hot reload for the interface, Electron pointed at it.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import electronPath from "electron";

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const server = await createServer({ configFile: path.join(desktop, "renderer", "vite.config.ts") });
await server.listen();
const url = server.resolvedUrls.local[0];
console.log(`interface on ${url}`);

const child = spawn(electronPath, ["."], {
  cwd: desktop,
  stdio: "inherit",
  env: { ...process.env, VITE_DEV_SERVER_URL: url },
});
child.on("exit", async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
