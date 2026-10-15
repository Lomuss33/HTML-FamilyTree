import { createProject, PASSWORD, fixture } from "../test/helpers/project.mjs";
import { createLocalServer } from "./local-server.mjs";
import { assertContained } from "./lib/project-paths.mjs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Isolated fictional data for a browser check; never open the owner's private tree.
const nodes = await fixture("valid-public-anchor.json");
for (const node of nodes) node.data.avatar = "";
const { paths } = await createProject(null, { site: true, nodes });
let faultMode = process.env.FAMILY_PREVIEW_SAVE_FAULT ?? "";
if (!["", "fail-once", "lost-response-once"].includes(faultMode)) throw new Error("Unknown fictional save fault.");
let saveResponse;
const { server } = await createLocalServer({ root: paths.root, environment: "test", fault: async point => {
  if (faultMode === "fail-once" && point === "after:encrypted") {
    faultMode = "";
    throw new Error("Injected fictional disk failure");
  }
  if (faultMode === "lost-response-once" && point === "verify") {
    faultMode = "";
    saveResponse.destroy();
    // Leave a real in-progress journal long enough to check the lost response.
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
} });
server.on("request", (request, response) => {
  if (request.method === "POST" && request.url === "/api/save") saveResponse = response;
});
// Exercise a GitHub Pages-style repository path without changing the real
// server's serving rules or introducing a test endpoint into the website.
server.prependListener("request", request => {
  if (request.url?.startsWith("/family-preview/")) request.url = request.url.slice("/family-preview".length);
});
server.listen(Number(process.env.FAMILY_PREVIEW_PORT ?? 4175), "127.0.0.1", () => {
  console.log("Fictional preview: http://127.0.0.1:" + server.address().port);
  console.log("Fictional preview root: " + paths.root);
  console.log("Fictional preview password: " + PASSWORD);
});
let closing = false;
async function close() {
  if (closing) return; closing = true;
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  assertContained(os.tmpdir(), paths.root);
  if (!path.basename(paths.root).startsWith("family-repair-")) throw new Error("Unsafe preview cleanup.");
  await rm(paths.root, { recursive: true, force: true });
}
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => void close());
process.stdin.on("data", data => { if (String(data).trim() === "quit") void close().then(() => process.stdin.pause()); });
server.once("error", () => {
  console.error("Fictional preview could not start; choose another FAMILY_PREVIEW_PORT.");
  process.exitCode = 1;
  void close().then(() => process.stdin.pause());
});
