import { test as base, expect } from "@playwright/test";
import http from "node:http";
import https from "node:https";
import { readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createLocalServer } from "../../scripts/local-server.mjs";
import { createLocalSuggestions } from "../../scripts/lib/local-suggestions.mjs";
import { assertContained } from "../../scripts/lib/project-paths.mjs";
import { createProject, fixture, hashes, PASSWORD } from "../helpers/project.mjs";
import { decryptFamily } from "../../scripts/lib/family-crypto.mjs";

const CODE = "fictional-homelab-browser-code";
const test = base.extend({
  homelab: async ({ context }, use) => {
    const nodes = await fixture("valid-public-anchor.json");
    for (const person of nodes) person.data.avatar = "";
    const project = await createProject(null, { site: true, nodes });
    const listeners = [];
    const tls = { cert: await readFile(new URL("../fixtures/tls/fictional.cert.pem", import.meta.url)),
      key: await readFile(new URL("../fixtures/tls/fictional.key.pem", import.meta.url)) };
    const backends = {};
    const origins = {};
    try {
      // Real TLS termination and Host/Origin forwarding over loopback. This
      // exercises the proxy boundary without contacting a tailnet or homelab.
      for (const access of ["public", "private"]) {
        const proxy = https.createServer(tls, (request, response) => {
          const upstream = http.request({ hostname: "127.0.0.1", port: backends[access].address().port,
            method: request.method, path: request.url, headers: request.headers }, result => {
            response.writeHead(result.statusCode, result.headers);
            result.pipe(response);
          });
          upstream.on("error", () => { response.writeHead(502); response.end(); });
          request.pipe(upstream);
        });
        await new Promise(resolve => proxy.listen(0, "127.0.0.1", resolve));
        listeners.push(proxy);
        origins[access] = "https://fictional-homelab.test:" + proxy.address().port;
      }
      const app = await createLocalServer({ root: project.paths.root, homelab: {
        publicOrigin: origins.public, privateOrigin: origins.private, publicPort: 4180, privatePort: 4181 } });
      for (const [access, server] of [["public", app.publicServer], ["private", app.server]]) {
        backends[access] = server;
        await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
        listeners.push(server);
      }
      const suggestions = createLocalSuggestions(project.paths, { logger: { info() {}, warn() {}, error() {} } });
      await suggestions.configure({ accessCode: CODE, password: PASSWORD });
      const requests = [];
      const unexpected = [];
      await context.route("**/*", route => {
        const url = new URL(route.request().url());
        if (!Object.values(origins).includes(url.origin)) { unexpected.push(url.origin); return route.abort("blockedbyclient"); }
        requests.push({ origin: url.origin, path: url.pathname });
        return route.continue();
      });
      await use({ ...project, origins, requests, suggestions });
      expect(unexpected).toEqual([]);
    } finally {
      for (const server of listeners.reverse()) {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
      }
      assertContained(os.tmpdir(), project.paths.root);
      if (!path.basename(project.paths.root).startsWith("family-repair-")) throw new Error("Unsafe fictional cleanup.");
      await rm(project.paths.root, { recursive: true, force: true });
    }
  }
});

test.use({ ignoreHTTPSErrors: true, launchOptions: { args: [
  "--host-resolver-rules=MAP fictional-homelab.test 127.0.0.1", "--no-proxy-server"
] } });

test("public HTTPS visitors browse and submit with a code without loading private data or administration", async ({ page, homelab }) => {
  const before = await hashes(homelab.paths);
  await page.goto(homelab.origins.public);
  await expect(page.locator("#public-tree-button")).toBeEnabled();
  await expect(page.locator("#admin-entry")).toBeHidden();
  await expect(page.locator("#guest-suggest-button")).toBeVisible();
  await page.locator("#public-tree-button").click();
  await expect(page.locator("#family-chart")).toContainText("Reviewed Public Label");
  await expect(page.locator("body")).not.toContainText("NeverPublic");
  await expect(page.locator("#edit-button")).toBeHidden();
  await expect(page.locator("#admin-review-button")).toBeHidden();
  await page.locator("#clear-session").click();
  await expect(page.locator("#admin-entry")).toBeHidden();
  await page.locator("#guest-suggest-button").click();
  await page.locator("#suggestion-name").fill("Fictional homelab visitor");
  await page.locator("#suggestion-message").fill("Fictional public HTTPS correction");
  await page.locator("#suggestion-code").fill(CODE);
  await page.locator("#suggestion-submit").click();
  await expect(page.locator("#suggestion-status")).toContainText("sent for review");
  expect(homelab.requests.some(request => request.origin === homelab.origins.private
    || request.path === "/api/status" || request.path === "/data/family.enc.json" || request.path.startsWith("/api/admin/"))).toBe(false);
  expect((await homelab.suggestions.list({ status: "pending" })).items).toHaveLength(1);
  expect(await hashes(homelab.paths)).toEqual(before);
  const blocked = await page.evaluate(async () => {
    const results = [];
    for (const route of ["/data/family.enc.json", "/api/status", "/api/save"]) results.push((await fetch(route)).status);
    return results;
  });
  expect(blocked).toEqual([404, 404, 404]);
});

test("private HTTPS DNS entry unlocks, reviews and saves; only approved changes reach public visitors", async ({ page, context, homelab }) => {
  await page.goto(homelab.origins.private);
  await page.locator("#admin-unlock-title").click();
  await page.locator("#password").fill(PASSWORD);
  await page.locator("#unlock-button").click();
  await expect(page.locator("#edit-button")).toBeVisible();
  await expect(page.locator("#admin-review-button")).toBeVisible();
  const publicPage = await context.newPage();
  await publicPage.goto(homelab.origins.public);
  await publicPage.locator("#guest-suggest-button").click();
  await publicPage.locator("#suggestion-name").fill("Fictional remote visitor");
  await publicPage.locator("#suggestion-message").fill("Fictional remote correction");
  await publicPage.locator("#suggestion-code").fill(CODE);
  await publicPage.locator("#suggestion-submit").click();
  await expect(publicPage.locator("#suggestion-status")).toContainText("sent for review");
  await page.locator("#admin-review-button").click();
  await page.locator(".admin-suggestion-item").filter({ hasText: "Fictional remote visitor" }).click();
  await expect(page.locator("#admin-detail-message")).toHaveText("Fictional remote correction");
  await page.locator("#admin-dialog-close").click();
  await page.locator("#people-button").click();
  await page.locator("#people-search").fill("PrivateOnlyFirst");
  await page.locator("#people-results .person-link").click();
  await page.locator(".person-privacy summary").click();
  await page.locator('input[name="publicLabel"]').fill("Fictional homelab reviewed update");
  await page.getByRole("button", { name: "Primijeni u nacrt", exact: true }).click();
  await page.locator("#people-close").click();
  const before = await hashes(homelab.paths);
  let review = "";
  page.once("dialog", dialog => { review = dialog.message(); return dialog.accept(); });
  await page.locator("#save-button").click();
  await expect(page.locator("#tree-status")).toContainText("Saved and verified");
  expect(review).toContain("Fictional homelab reviewed update");
  expect(await hashes(homelab.paths)).not.toEqual(before);
  await publicPage.reload();
  await publicPage.locator("#public-tree-button").click();
  await expect(publicPage.locator("#family-chart")).toContainText("Fictional homelab reviewed update");
  await expect(publicPage.locator("body")).not.toContainText("NeverPublic");
  const saved = await decryptFamily(JSON.parse(await readFile(homelab.paths.encrypted, "utf8")), PASSWORD);
  expect(saved).toEqual(JSON.parse(await readFile(homelab.paths.canonical, "utf8")));
  await page.locator("#clear-session").click();
  await page.reload();
  await expect(page.locator("#lock-screen")).toBeVisible();
  await expect(page.locator("#edit-button")).toBeHidden();
  await publicPage.close();
});

test("unavailable public suggestion status keeps the public viewer usable without contacting cloud services", async ({ page, homelab }) => {
  await page.route("**/api/public-status", route => route.fulfill({ status: 503, contentType: "application/json", body: "{}" }));
  await page.goto(homelab.origins.public);
  await expect(page.locator("#public-tree-button")).toBeEnabled();
  await expect(page.locator("#guest-suggest-button")).toBeHidden();
  await page.locator("#public-tree-button").click();
  await expect(page.locator("#family-chart")).toContainText("Reviewed Public Label");
  await expect(page.locator("#admin-entry")).toBeHidden();
});
