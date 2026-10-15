import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

const PASSWORD = "fictional-test-password-only";
const ORIGIN = "http://127.0.0.1:4175";
let unexpectedRequests;

test.beforeEach(async ({ context }) => {
  unexpectedRequests = [];
  await context.route("**/*", route => {
    if (new URL(route.request().url()).origin === ORIGIN) return route.continue();
    unexpectedRequests.push(route.request().url());
    return route.abort("blockedbyclient");
  });
});
test.afterEach(() => expect(unexpectedRequests).toEqual([]));

async function unlock(page, pathname = "/") {
  await page.goto(pathname);
  await page.locator("#password").fill(PASSWORD);
  await page.locator("#unlock-button").click();
  await expect(page.locator("#tree-shell")).toBeVisible();
  await expect(page.locator("#edit-button")).toBeVisible();
}

async function editDate(page, value) {
  await page.locator("#edit-button").click();
  await page.locator('input[name="birthday"]').fill(value);
}

test("fresh unlock, unfinished card Save, safe text, and memory-only locking", async ({ page }) => {
  await page.goto("/");
  await page.locator("#password").fill("incorrect-fictional-password");
  await page.locator("#unlock-button").click();
  await expect(page.locator("#status-message")).toContainText("Unable to unlock");
  await unlock(page);
  await expect(page.locator("#admin-review-button")).toBeHidden();
  await expect(page.locator("#suggest-button")).toBeHidden();
  await page.locator("#edit-button").click();
  const name = 'Fictional čćžšđ <img src=x onerror="window.injected=true">';
  await page.locator('input[name="first name"]').fill(name);
  await page.locator("#save-button").click();
  await expect(page.locator("#tree-status")).toContainText("Saved and verified");
  await expect(page.locator(".personal-tree-card strong").first()).toContainText(name);
  expect(await page.evaluate(() => ({ injected: window.injected === true, storage: Object.keys(sessionStorage) })))
    .toEqual({ injected: false, storage: [] });
  await page.locator("#clear-session").click();
  await expect(page.locator(".personal-tree-card")).toHaveCount(0);
  await unlock(page);
  await expect(page.locator(".personal-tree-card strong").first()).toContainText(name);
  await page.reload();
  await expect(page.locator("#lock-screen")).toBeVisible();
});

test("unfinished-card cancellation and a lost save response preserve recoverable state", async ({ page }) => {
  await unlock(page);
  await editDate(page, "Fictional response recovery");
  page.once("dialog", dialog => dialog.dismiss());
  await page.locator(".f3-cancel-btn").click();
  await expect(page.locator('input[name="birthday"]')).toHaveValue("Fictional response recovery");
  let saves = 0;
  await page.route("**/api/save", async route => {
    saves++;
    await route.fetch();
    await route.abort("failed");
  });
  await page.locator("#save-button").click();
  await expect(page.locator("#save-button")).toHaveText("Check save");
  await expect(page.locator("#tree-status")).toContainText("draft is kept");
  await page.locator("#save-button").click();
  await expect(page.locator("#tree-status")).toContainText("Saved and verified");
  expect(saves).toBe(1);
  await page.locator("#clear-session").click();
  await unlock(page);
  await expect(page.locator(".personal-tree-card").first()).toContainText("Fictional response recovery");
});

test("a stale tab keeps its draft and can download it without overwriting the newer tree", async ({ page, context }) => {
  await unlock(page);
  const newer = await context.newPage();
  await unlock(newer);
  await editDate(newer, "Fictional newer date");
  await newer.locator("#save-button").click();
  await expect(newer.locator("#tree-status")).toContainText("Saved and verified");
  await editDate(page, "Fictional stale draft");
  await page.locator("#save-button").click();
  await expect(page.locator("#tree-status")).toContainText("newer tree was saved");
  await expect(page.locator(".personal-tree-card").first()).toContainText("Fictional stale draft");
  const downloading = page.waitForEvent("download");
  await page.locator("#export-draft-button").click();
  const download = await downloading;
  expect(await readFile(await download.path(), "utf8")).toContain("Fictional stale draft");
  await newer.reload();
  await unlock(newer);
  await expect(newer.locator(".personal-tree-card").first()).toContainText("Fictional newer date");
  await newer.close();
});

test("phone-width toolbar and card form fit under a repository publication path", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await unlock(page, "/family-preview/");
  await page.locator("#edit-button").click();
  await expect(page.locator('input[name="birthday"]')).toBeVisible();
  const layout = await page.evaluate(() => {
    const form = document.querySelector(".f3-form-cont.opened").getBoundingClientRect();
    const stage = document.querySelector("#family-chart").getBoundingClientRect();
    const save = document.querySelector("#save-button").getBoundingClientRect();
    return { overflow: document.documentElement.scrollWidth > innerWidth,
      formFits: form.left >= stage.left - 1 && form.right <= stage.right + 1,
      touchHeight: save.height,
      fontSize: getComputedStyle(document.querySelector('input[name="birthday"]')).fontSize };
  });
  expect(layout.overflow).toBe(false);
  expect(layout.formFits).toBe(true);
  // Subpixel rounding at desktop zoom levels can report 43.99 for a 44 px control.
  expect(layout.touchHeight).toBeGreaterThanOrEqual(43.5);
  expect(layout.fontSize).toBe("16px");
});

test("failed saving keeps the draft and Discard and Lock require the intended decision", async ({ page }) => {
  await unlock(page);
  const originalDate = await page.locator(".personal-tree-card").first().textContent();
  await editDate(page, "Fictional failed-save draft");
  await page.route("**/api/save", route => route.fulfill({ status: 500, contentType: "application/json",
    body: JSON.stringify({ ok: false, code: "SAVE_FAILED", message: "Fictional failed save" }) }));
  await page.locator("#save-button").click();
  await expect(page.locator("#tree-status")).toContainText("Fictional failed save");
  await expect(page.locator(".personal-tree-card").first()).toContainText("Fictional failed-save draft");
  await expect(page.locator("#export-draft-button")).toBeVisible();
  page.once("dialog", dialog => dialog.dismiss());
  await page.locator("#clear-session").click();
  await expect(page.locator("#tree-shell")).toBeVisible();
  page.once("dialog", dialog => dialog.dismiss());
  await page.locator("#discard-button").click();
  await expect(page.locator(".personal-tree-card").first()).toContainText("Fictional failed-save draft");
  page.once("dialog", dialog => dialog.accept());
  await page.locator("#discard-button").click();
  await expect(page.locator(".personal-tree-card").first()).toHaveText(originalDate);
  await page.locator("#clear-session").click();
  await expect(page.locator(".personal-tree-card")).toHaveCount(0);
});

test("checking an in-progress receipt retains the original save until its committed receipt arrives", async ({ page }) => {
  await unlock(page);
  await editDate(page, "Fictional pending receipt");
  let saves = 0;
  await page.route("**/api/save", async route => { saves++; await route.fetch(); await route.abort("failed"); });
  await page.locator("#save-button").click();
  await expect(page.locator("#save-button")).toHaveText("Check save");
  let firstCheck = true;
  await page.route("**/api/operations/*", route => {
    if (firstCheck) {
      firstCheck = false;
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ state: "replacing", result: null }) });
    }
    return route.continue();
  });
  await page.locator("#save-button").click();
  await expect(page.locator("#tree-status")).toContainText("still running");
  await expect(page.locator("#save-button")).toHaveText("Check save");
  await page.locator("#save-button").click();
  await expect(page.locator("#tree-status")).toContainText("Saved and verified");
  expect(saves).toBe(1);
});

test("confirmed reload locks the viewer and cannot turn an unsaved draft into saved data", async ({ page }) => {
  await unlock(page);
  const saved = await page.locator(".personal-tree-card").first().textContent();
  await editDate(page, "Fictional uncommitted reload draft");
  page.once("dialog", dialog => dialog.accept());
  await page.reload();
  await expect(page.locator("#lock-screen")).toBeVisible();
  expect(await page.evaluate(() => Object.keys(sessionStorage))).toEqual([]);
  await unlock(page);
  await expect(page.locator(".personal-tree-card").first()).toHaveText(saved);
});
