import path from "node:path";
import { pathToFileURL } from "node:url";
import { createLocalServer } from "./local-server.mjs";
import { validateHomelabConfig } from "./lib/homelab-access.mjs";
import { parseArgs, readJson, safeErrorMessage, FamilyWorkflowError, REPOSITORY_ROOT } from "./lib/project-paths.mjs";

export async function startHomelab({ root = REPOSITORY_ROOT, config, ...options } = {}) {
  config = validateHomelabConfig(config);
  const app = await createLocalServer({ ...options, root, host: "127.0.0.1", homelab: config });
  const listeners = [app.server, app.publicServer];
  async function close() {
    await Promise.all(listeners.map(server => new Promise((resolve, reject) => {
      server.close(error => error && error.code !== "ERR_SERVER_NOT_RUNNING" ? reject(error) : resolve());
    })));
  }
  async function listen(server, port) {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => { server.off("error", reject); resolve(); });
    });
  }
  try {
    await listen(app.server, config.privatePort);
    await listen(app.publicServer, config.publicPort);
    return { ...app, close };
  } catch (error) { await close(); throw error; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (Object.keys(args).some(key => !["root", "config"].includes(key))
      || Object.values(args).some(value => typeof value !== "string")) {
      throw new FamilyWorkflowError("INVALID_ARGUMENT", "Use only --root <directory> and --config <file>.");
    }
    const root = path.resolve(args.root ?? REPOSITORY_ROOT);
    const config = await readJson(path.resolve(root, args.config ?? "config/homelab.local.json"));
    const app = await startHomelab({ root, config });
    console.log("Homelab backends ready on loopback: public " + config.publicPort + ", private " + config.privatePort + ".");
    console.log("HTTPS proxies and Tailscale access rules must be configured separately before use.");
    let closing = false;
    for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => {
      if (closing) return;
      closing = true;
      void app.close().catch(() => { console.error("Homelab shutdown needs inspection."); process.exitCode = 1; });
    });
  } catch (error) {
    console.error(error.code === "EADDRINUSE" ? "A configured homelab port is already in use."
      : safeErrorMessage(error, "Homelab startup failed. Check the local configuration, ports and recovery state."));
    process.exitCode = 1;
  }
}
