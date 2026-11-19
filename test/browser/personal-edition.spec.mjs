import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { decryptFamily } from "../../scripts/lib/family-crypto.mjs";
import { buildPublicAnchorArtifacts } from "../../scripts/generate-public-anchors.mjs";

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

async function openAdminAccess(page) {
  if (!await page.locator("#password").isVisible()) await page.locator("#admin-unlock-title").click();
}

async function unlock(page, pathname = "/") {
  await page.goto(pathname);
  await openAdminAccess(page);
  await page.locator("#password").fill(PASSWORD);
  await page.locator("#unlock-button").click();
  await expect(page.locator("#tree-shell")).toBeVisible();
  await expect(page.locator("#edit-button")).toBeVisible();
}

async function editDate(page, value) {
  await page.locator("#edit-button").click();
  await page.locator('#family-chart input[name="birthday"]').fill(value);
}

async function savedFictionalNodes(page) {
  const status = await (await page.request.get("/api/status")).json();
  const response = await page.request.post("/api/session", { headers: { Origin: ORIGIN, "X-Family-Local-Token": status.csrfToken },
    data: { password: PASSWORD, payloadDigest: status.payloadDigest } });
  expect(response.status()).toBe(200);
  return (await response.json()).nodes;
}

async function expectChartPeople(page, names) {
  await expect.poll(async () => (await page.locator("#family-chart .personal-tree-card strong").allTextContents()).sort()).toEqual([...names].sort());
}

test("a failed module load cannot put the family password into a native form URL or body", async ({ page }) => {
  await page.route("**/assets/admin/review-workspace.js", route => route.abort("failed"));
  await page.goto("/");
  await page.locator("#admin-unlock-title").click();
  await expect(page.locator("#password")).toBeDisabled();
  await expect(page.locator("#unlock-button")).toBeDisabled();
  const submitted = page.waitForRequest(request => request.isNavigationRequest() && request.method() === "POST");
  await page.locator("#unlock-form").evaluate(form => {
    form.querySelector("#password").value = "fictional-native-form-canary";
    form.requestSubmit();
  });
  const request = await submitted;
  expect(new URL(request.url()).search).toBe("");
  expect(request.postData() ?? "").not.toContain("fictional-native-form-canary");
});

test("mobile entrance retains the original palette and updated navigation", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator("#public-tree-button")).toBeEnabled();
  await expect(page.locator("#password")).toBeHidden();
  await expect(page.locator("#public-search")).toBeHidden();
  const appearance = await page.evaluate(() => {
    const button = document.querySelector("#public-tree-button");
    const bounds = button.getBoundingClientRect();
    const style = getComputedStyle(button);
    const luminance = color => {
      const values = color.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => {
        const s = value / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
    };
    const text = luminance(style.color);
    const contrast = color => { const background = luminance(color); return (Math.max(text, background) + 0.05) / (Math.min(text, background) + 0.05); };
    const stops = style.backgroundImage.match(/rgb\([^)]+\)/g);
    return { overflow: document.documentElement.scrollWidth > innerWidth,
      actionFits: bounds.top >= 0 && bounds.bottom <= innerHeight, touchHeight: bounds.height,
      buttonContrast: Math.min(...stops.map(contrast)),
      backgroundColor: getComputedStyle(document.documentElement).backgroundColor };
  });
  expect(appearance.overflow).toBe(false);
  expect(appearance.actionFits).toBe(true);
  expect(appearance.touchHeight).toBeGreaterThanOrEqual(44);
  expect(appearance.buttonContrast).toBeGreaterThanOrEqual(4.5);
  expect(appearance.backgroundColor).toBe("rgb(214, 194, 163)");
  await page.screenshot({ path: testInfo.outputPath("pocetni-mobitel.png"), animations: "disabled" });
  await page.locator("#public-people-title").focus();
  await page.locator("#public-people-title").press("Enter");
  await page.locator("#public-search").fill("1901");
  await page.getByRole("button", { name: "Otvori javni profil: Reviewed Public Label", exact: true }).click();
  await expect(page.locator("#person-detail-name")).toHaveText("Reviewed Public Label");
  await expect(page.locator("#edit-button")).toBeHidden();
  await page.locator("#people-close").click();
  await page.locator("#clear-session").click();
  await expect(page.locator("#public-search")).toBeHidden();
  await expect(page.locator("#password")).toBeHidden();
  await page.setViewportSize({ width: 1280, height: 800 });
  await unlock(page);
  await personProfile(page, "Child Example");
  await page.getByRole("button", { name: "Pokaži u stablu", exact: true }).click();
  await expect(page.getByRole("button", { name: "Otvori osobu: Parent Example", exact: true })).toBeVisible();
  await page.waitForFunction(() => ![...document.querySelectorAll("#family-chart, #family-chart *")].some(element => element.__transition));
  await page.screenshot({ path: testInfo.outputPath("izmisljeno-stablo.png"), animations: "disabled" });
});

test("fresh unlock, unfinished card Save, safe text, and memory-only locking", async ({ page }) => {
  await page.goto("/");
  await openAdminAccess(page);
  await page.locator("#password").fill("incorrect-fictional-password");
  await page.locator("#unlock-button").click();
  await expect(page.locator("#status-message")).toContainText("Unable to unlock");
  await unlock(page);
  await expect(page.locator("#admin-review-button")).toBeVisible();
  await expect(page.locator("#suggest-button")).toBeHidden();
  await page.locator("#edit-button").click();
  const name = 'Fictional čćžšđ <img src=x onerror="window.injected=true">';
  await page.locator('#family-chart input[name="first name"]').fill(name);
  await page.locator("#save-button").click();
  await expect(page.locator("#tree-status")).toContainText("Saved and verified");
  await expect(page.locator(".personal-tree-card strong").first()).toContainText(name);
  expect(await page.evaluate(() => ({ injected: window.injected === true, storage: Object.keys(sessionStorage) })))
    .toEqual({ injected: false, storage: [] });
  await page.locator("#people-button").click();
  await page.locator("#people-search").fill("čćžšđ");
  await page.locator("#people-results .person-link").click();
  await expect(page.locator("#person-detail-name")).toHaveText(name + " PrivateOnlyLast");
  await expect(page.locator("#person-detail img")).toHaveCount(0);
  await page.locator("#people-close").click();
  await page.locator("#clear-session").click();
  await expect(page.locator(".personal-tree-card")).toHaveCount(0);
  await expect(page.locator("#people-results, #person-detail")).toHaveText(["", ""]);
  await expect(page.locator("#people-search")).toHaveValue("");
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
  await expect(page.locator('#family-chart input[name="birthday"]')).toHaveValue("Fictional response recovery");
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
  await expect(page.locator('#family-chart input[name="birthday"]')).toBeVisible();
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

test("search reaches disconnected people and chart cards open a keyboard-accessible profile", async ({ page }) => {
  await unlock(page);
  await page.locator("#people-button").click();
  await page.locator("#people-search").fill("person neverpublic 1980");
  await expect(page.locator("#people-results .person-link")).toHaveCount(1);
  await page.locator("#people-results .person-link").click();
  await expect(page.locator("#person-detail-name")).toHaveText("NeverPublic Person");
  await expect(page.locator('#person-detail section[aria-label="Djeca"]')).toContainText("Nema upisanih podataka.");
  await page.getByRole("button", { name: "Pokaži u stablu", exact: true }).click();
  await expect(page.locator("#people-dialog")).not.toBeVisible();
  const card = page.getByRole("button", { name: "Otvori osobu: NeverPublic Person", exact: true });
  await expect(card).toBeVisible();
  await card.focus();
  await card.press("Enter");
  await expect(page.locator("#person-detail-name")).toHaveText("NeverPublic Person");
  await page.keyboard.press("Escape");
  await expect(page.locator("#people-button")).toBeFocused();
});

async function fillFamilyPerson(page, first, last, gender = "F") {
  await page.locator('.family-new-person input[name="first name"]').fill(first);
  await page.locator('.family-new-person input[name="last name"]').fill(last);
  await page.locator('.family-new-person select[name="gender"]').selectOption(gender);
}

async function draftFictionalNodes(page) {
  const downloading = page.waitForEvent("download");
  await page.locator("#export-draft-button").click();
  const download = await downloading;
  return JSON.parse(await readFile(await download.path(), "utf8"));
}

function reviewedCatalog(json) {
  const { sourceRevision, ...catalog } = JSON.parse(json);
  return catalog;
}

test("quick standalone entry fits a phone, keeps cancelled input and survives failed saving before a verified Save", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await unlock(page, "/family-preview/");
  const before = await savedFictionalNodes(page), edition = await editionBytes();
  await page.locator("#people-button").click();
  await page.locator("#people-add").click();
  await page.getByRole("button", { name: "Dodaj u nacrt", exact: true }).click();
  expect(await page.locator('.family-new-person input[name="first name"]').evaluate(input => input.validity.customError)).toBe(true);
  const first = 'QuickEntry <img src=x onerror="window.quickInjected=true">';
  await fillFamilyPerson(page, first, "Fictional");
  await page.locator('.family-new-person input[name="birthday"]').fill("oko 1987");
  const layout = await page.locator("#people-dialog").evaluate(dialog => ({ overflow: dialog.scrollWidth > dialog.clientWidth + 1,
    fontSize: getComputedStyle(dialog.querySelector('.family-new-person input')).fontSize,
    actionHeight: dialog.querySelector('.family-edit-actions button[type="submit"]').getBoundingClientRect().height }));
  expect(layout).toEqual({ overflow: false, fontSize: "16px", actionHeight: 44 });
  page.once("dialog", dialog => dialog.dismiss());
  await page.getByRole("button", { name: "Odustani", exact: true }).click();
  await expect(page.locator('.family-new-person input[name="first name"]')).toHaveValue(first);
  page.once("dialog", dialog => dialog.dismiss());
  await page.keyboard.press("Escape");
  await expect(page.locator("#family-edit-panel")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("dodavanje-mobitel.png"), animations: "disabled" });
  expect(await editionBytes()).toEqual(edition);
  await page.getByRole("button", { name: "Dodaj u nacrt", exact: true }).click();
  await expect(page.locator("#person-detail-name")).toHaveText(first + " Fictional");
  await expect(page.locator("#family-edit-result")).toContainText("nacrtu");
  await expect(page.locator("#person-detail img")).toHaveCount(0);
  expect(await page.evaluate(() => window.quickInjected === true)).toBe(false);
  await page.locator("#people-close").click();
  const draft = await draftFictionalNodes(page), added = draft.at(-1);
  expect(draft.slice(0, -1)).toEqual(before);
  expect(added.privacy).toEqual({ publicAnchor: false });
  expect(added.rels).toEqual({ parents: [], children: [], spouses: [] });
  expect(added.data.birthday).toBe("oko 1987");
  expect(await editionBytes()).toEqual(edition);
  await page.route("**/api/save", route => route.fulfill({ status: 500, contentType: "application/json",
    body: JSON.stringify({ ok: false, code: "SAVE_FAILED", message: "Fictional quick-entry save failure" }) }));
  await page.locator("#save-button").click();
  await expect(page.locator("#tree-status")).toContainText("Fictional quick-entry save failure");
  await personProfile(page, "QuickEntry");
  await expect(page.locator("#person-detail-name")).toHaveText(first + " Fictional");
  await page.locator("#people-close").click();
  expect(await editionBytes()).toEqual(edition);
  await page.unroute("**/api/save");
  await page.locator("#save-button").click();
  await expect(page.locator("#tree-status")).toContainText("Saved and verified");
  expect(await savedFictionalNodes(page)).toEqual(draft);
  expect(await decryptFamily(await (await page.request.get("/data/family.enc.json")).json(), PASSWORD)).toEqual(draft);
  expect(reviewedCatalog((await editionBytes())[1])).toEqual(reviewedCatalog(edition[1]));
  await page.locator("#clear-session").click();
  await expect(page.locator("#family-edit-panel")).toHaveText("");
  await expect(page.locator("#people-add")).toBeHidden();
  await unlock(page);
  await personProfile(page, "QuickEntry");
  await expect(page.locator("#person-detail-name")).toHaveText(first + " Fictional");
});

test("quick existing-person links retain ids and unfinished card fields and Discard restores the complete source", async ({ page }) => {
  await unlock(page);
  const before = await savedFictionalNodes(page), edition = await editionBytes();
  await personProfile(page, "Focus Demo");
  await expect(page.getByRole("button", { name: "Dodaj roditelja", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Pokaži u stablu", exact: true }).click();
  await editDate(page, "Fictional unfinished card retained by linking");
  await personProfile(page, "Focus Demo");
  await page.getByRole("button", { name: "Dodaj partnera", exact: true }).click();
  await fillFamilyPerson(page, "Disconnected", "Demo");
  await expect(page.locator(".family-duplicate-warning")).toBeVisible();
  await page.locator('.family-duplicate-warning').getByRole("button", { name: "Disconnected Demo · 1980", exact: true }).click();
  await expect(page.locator("#family-person-mode")).toHaveValue("existing");
  await page.getByRole("button", { name: "Dodaj u nacrt", exact: true }).click();
  await expect(page.locator("#person-detail-name")).toHaveText("Disconnected Demo");
  await expect(page.locator('#person-detail section[aria-label="Partneri"]')).toContainText("Focus Demo");
  await expect(page.getByRole("button", { name: "Dodaj brata/sestru", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Dodaj partnera", exact: true }).click();
  await page.locator("#family-person-mode").selectOption("existing");
  await page.locator("#family-existing-search").fill("Focus Demo");
  await page.locator('.family-person-picker [data-person-id="near-focus"]').click();
  await page.getByRole("button", { name: "Dodaj u nacrt", exact: true }).click();
  await expect(page.locator("#family-edit-status")).toContainText("već upisana");
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Odustani", exact: true }).click();
  await page.locator("#people-close").click();
  const expected = structuredClone(before);
  expected.find(person => person.id === "near-focus").data.birthday = "Fictional unfinished card retained by linking";
  expected.find(person => person.id === "near-focus").rels.spouses.push("near-disconnected");
  expected.find(person => person.id === "near-disconnected").rels.spouses.push("near-focus");
  expect(await draftFictionalNodes(page)).toEqual(expected);
  expect(await savedFictionalNodes(page)).toEqual(before);
  expect(await editionBytes()).toEqual(edition);
  page.once("dialog", dialog => dialog.accept());
  await page.locator("#discard-button").click();
  await personProfile(page, "Disconnected Demo");
  await expect(page.locator('#person-detail section[aria-label="Partneri"]')).toContainText("Nema upisanih podataka.");
  await page.locator("#people-close").click();
  await expect(page.locator("#save-button")).toBeHidden();
});

test("quick sibling entry requires shared parents and duplicate consent while an invalid ancestry link retains its form", async ({ page }) => {
  await unlock(page);
  const before = await savedFictionalNodes(page), edition = await editionBytes();
  await personProfile(page, "Focus Demo");
  await page.getByRole("button", { name: "Dodaj brata/sestru", exact: true }).click();
  await fillFamilyPerson(page, "QuickSibling", "Fictional");
  await expect(page.locator('.family-shared-parents input:checked')).toHaveCount(0);
  await expect(page.locator('.family-edit-summary')).toHaveText("Odaberi barem jednog zajedničkog roditelja.");
  await page.getByRole("button", { name: "Dodaj u nacrt", exact: true }).click();
  await expect(page.locator("#family-edit-status")).toContainText("zajedničkog roditelja");
  await page.locator('.family-shared-parents input[value="near-father"]').check();
  await expect(page.locator('.family-edit-summary')).toHaveText("QuickSibling Fictional i Focus Demo imat će zajedničkog roditelja: Father Demo.");
  await page.locator('.family-shared-parents input[value="near-mother"]').check();
  await expect(page.locator('.family-edit-summary')).toHaveText("QuickSibling Fictional i Focus Demo imat će zajedničke roditelje: Father Demo i Mother Demo.");
  await page.locator('.family-shared-parents input[value="near-mother"]').uncheck();
  await expect(page.locator('.family-edit-summary')).not.toContainText("Mother Demo");
  await fillFamilyPerson(page, "Focus", "Demo");
  await page.getByRole("button", { name: "Dodaj u nacrt", exact: true }).click();
  await expect(page.locator("#family-edit-status")).toContainText("istog imena");
  await expect(page.locator('.family-new-person input[name="first name"]')).toHaveValue("Focus");
  await page.locator("#family-duplicate-ack").check();
  await page.getByRole("button", { name: "Dodaj u nacrt", exact: true }).click();
  await expect(page.locator('#person-detail section[aria-label="Roditelji"] .person-link strong')).toHaveText(["Father Demo"]);
  await page.locator("#people-close").click();
  const draft = await draftFictionalNodes(page), added = draft.at(-1), expected = structuredClone(before);
  expected.find(person => person.id === "near-father").rels.children.push(added.id);
  expect(draft.slice(0, -1)).toEqual(expected);
  expect(added.id).not.toBe("near-focus");
  expect(added.rels).toEqual({ parents: ["near-father"], children: [], spouses: [] });
  expect(added.privacy).toEqual({ publicAnchor: false });
  page.once("dialog", dialog => dialog.accept());
  await page.locator("#discard-button").click();
  await personProfile(page, "Grandparent Demo");
  await page.getByRole("button", { name: "Dodaj roditelja", exact: true }).click();
  await page.locator("#family-person-mode").selectOption("existing");
  await page.locator("#family-existing-search").fill("ChildOne Demo");
  await page.locator('.family-person-picker [data-person-id="near-child-one"]').click();
  await page.getByRole("button", { name: "Dodaj u nacrt", exact: true }).click();
  await expect(page.locator("#family-edit-status")).toContainText("krug");
  await expect(page.locator("#family-existing-search")).toHaveValue("ChildOne Demo");
  page.once("dialog", dialog => dialog.dismiss());
  await page.locator("#people-back").click();
  await expect(page.locator("#family-edit-panel")).toBeVisible();
  page.once("dialog", dialog => dialog.accept());
  await page.locator("#people-back").click();
  await expect(page.locator("#person-detail-name")).toHaveText("Grandparent Demo");
  expect(await savedFictionalNodes(page)).toEqual(before);
  expect(await editionBytes()).toEqual(edition);
});

test("quick new parents, partners and children stay in one private draft and save with only explicitly chosen parents", async ({ page }) => {
  await unlock(page);
  const before = await savedFictionalNodes(page), catalog = (await editionBytes())[1];
  await page.locator("#people-button").click();
  await page.locator("#people-add").click();
  await fillFamilyPerson(page, "QuickRoot", "Fictional");
  await page.getByRole("button", { name: "Dodaj u nacrt", exact: true }).click();
  await page.getByRole("button", { name: "Dodaj roditelja", exact: true }).click();
  await fillFamilyPerson(page, "QuickParent", "Fictional", "M");
  await page.getByRole("button", { name: "Dodaj u nacrt", exact: true }).click();
  await personProfile(page, "QuickRoot");
  await page.getByRole("button", { name: "Dodaj partnera", exact: true }).click();
  await fillFamilyPerson(page, "QuickPartner", "Fictional", "M");
  await page.getByRole("button", { name: "Dodaj u nacrt", exact: true }).click();
  await personProfile(page, "QuickRoot");
  await page.getByRole("button", { name: "Dodaj dijete", exact: true }).click();
  await fillFamilyPerson(page, "QuickChildOne", "Fictional");
  await expect(page.locator("#family-include-other-parent")).not.toBeChecked();
  await page.getByRole("button", { name: "Dodaj u nacrt", exact: true }).click();
  await personProfile(page, "QuickRoot");
  await page.getByRole("button", { name: "Dodaj dijete", exact: true }).click();
  await fillFamilyPerson(page, "QuickChildTwo", "Fictional", "M");
  await page.locator("#family-include-other-parent").check();
  await page.getByRole("button", { name: "Dodaj u nacrt", exact: true }).click();
  await expect(page.locator("#family-edit-status")).toContainText("Odaberi drugog roditelja");
  await page.locator("#family-other-parent-search").fill("QuickPartner");
  await page.locator('.family-other-parent .person-link').click();
  await page.getByRole("button", { name: "Dodaj u nacrt", exact: true }).click();
  await page.locator("#people-close").click();
  const draft = await draftFictionalNodes(page), added = draft.slice(before.length);
  expect(draft.slice(0, before.length)).toEqual(before);
  expect(added).toHaveLength(5);
  const byName = name => added.find(person => person.data["first name"] === name);
  expect(byName("QuickRoot").rels).toEqual({ parents: [byName("QuickParent").id], spouses: [byName("QuickPartner").id], children: [byName("QuickChildOne").id, byName("QuickChildTwo").id] });
  expect(byName("QuickChildOne").rels.parents).toEqual([byName("QuickRoot").id]);
  expect(byName("QuickChildTwo").rels.parents).toEqual([byName("QuickRoot").id, byName("QuickPartner").id]);
  expect(added.every(person => person.privacy.publicAnchor === false)).toBe(true);
  await page.locator("#save-button").click();
  await expect(page.locator("#tree-status")).toContainText("Saved and verified");
  expect(await savedFictionalNodes(page)).toEqual(draft);
  expect(await decryptFamily(await (await page.request.get("/data/family.enc.json")).json(), PASSWORD)).toEqual(draft);
  expect(reviewedCatalog((await editionBytes())[1])).toEqual(reviewedCatalog(catalog));
  await page.locator("#clear-session").click();
  await page.locator("#public-tree-button").click();
  await personProfile(page, "Reviewed Public Label");
  await expect(page.locator("#people-add")).toBeHidden();
  await expect(page.locator(".family-add-actions")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("QuickRoot");
});

test("switching new and existing child entry retains typed data and offers only compatible second parents", async ({ page }) => {
  await unlock(page);
  const before = await savedFictionalNodes(page), edition = await editionBytes();
  await personProfile(page, "Focus Demo");
  await page.getByRole("button", { name: "Dodaj dijete", exact: true }).click();
  await fillFamilyPerson(page, "ModeSwitchChild", "Fictional");
  await page.locator('.family-new-person input[name="birthday"]').fill("oko 2012");
  await page.locator("#family-person-mode").selectOption("existing");
  await page.locator("#family-existing-search").fill("Disconnected Demo");
  await page.locator('.family-edit-form > .family-person-picker [data-person-id="near-disconnected"]').click();
  await page.locator("#family-include-other-parent").check();
  await page.locator("#family-other-parent-search").fill("CoParent Demo");
  await page.locator('.family-other-parent [data-person-id="near-coparent"]').click();
  await page.locator("#family-person-mode").selectOption("new");
  await expect(page.locator('.family-new-person input[name="first name"]')).toHaveValue("ModeSwitchChild");
  await expect(page.locator('.family-new-person input[name="birthday"]')).toHaveValue("oko 2012");
  await page.locator("#family-other-parent-search").fill("Disconnected Demo");
  await expect(page.locator('.family-other-parent [data-person-id="near-disconnected"]')).toBeVisible();
  await page.locator('.family-other-parent [data-person-id="near-disconnected"]').click();
  await page.locator("#family-person-mode").selectOption("existing");
  await expect(page.locator('.family-other-parent .family-selected-person')).toHaveText("Osoba nije odabrana.");
  await page.getByRole("button", { name: "Dodaj u nacrt", exact: true }).click();
  await expect(page.locator("#family-edit-status")).toContainText("Odaberi drugog roditelja");
  await page.locator("#family-person-mode").selectOption("new");
  await expect(page.locator('.family-new-person input[name="first name"]')).toHaveValue("ModeSwitchChild");
  await page.locator("#family-other-parent-search").fill("Disconnected Demo");
  await page.locator('.family-other-parent [data-person-id="near-disconnected"]').click();
  await page.getByRole("button", { name: "Dodaj u nacrt", exact: true }).click();
  await expect(page.locator("#person-detail-name")).toHaveText("ModeSwitchChild Fictional");
  await page.locator("#people-close").click();
  const draft = await draftFictionalNodes(page), added = draft.at(-1), expected = structuredClone(before);
  expected.find(person => person.id === "near-focus").rels.children.push(added.id);
  expected.find(person => person.id === "near-disconnected").rels.children.push(added.id);
  expect(draft.slice(0, -1)).toEqual(expected);
  expect(added.data.birthday).toBe("oko 2012");
  expect(added.rels).toEqual({ parents: ["near-focus", "near-disconnected"], children: [], spouses: [] });
  expect(added.privacy).toEqual({ publicAnchor: false });
  expect(await savedFictionalNodes(page)).toEqual(before);
  expect(await editionBytes()).toEqual(edition);
  page.once("dialog", dialog => dialog.accept());
  await page.locator("#discard-button").click();
  await expect(page.locator("#save-button")).toBeHidden();
});

test("choosing a duplicate match keeps a compatible second parent and never overwrites the existing person's fields", async ({ page }) => {
  await unlock(page);
  const before = await savedFictionalNodes(page), edition = await editionBytes();
  await personProfile(page, "Father Demo");
  await page.getByRole("button", { name: "Dodaj dijete", exact: true }).click();
  await page.locator("#family-person-mode").selectOption("existing");
  await page.locator("#family-existing-search").fill("Mother Demo");
  await page.locator('.family-edit-form > .family-person-picker [data-person-id="near-mother"]').click();
  await page.locator("#family-person-mode").selectOption("new");
  await fillFamilyPerson(page, "Disconnected", "Demo");
  await page.locator('.family-new-person input[name="birthday"]').fill("Fictional value that must never replace an existing record");
  await page.locator("#family-include-other-parent").check();
  await page.locator("#family-other-parent-search").fill("Mother Demo");
  await page.locator('.family-other-parent [data-person-id="near-mother"]').click();
  await page.locator('.family-duplicate-warning').getByRole("button", { name: "Disconnected Demo · 1980", exact: true }).click();
  await expect(page.locator("#family-person-mode")).toHaveValue("existing");
  await expect(page.locator('.family-other-parent .family-selected-person')).toHaveText("Odabrano: Mother Demo · 1942");
  await expect(page.locator('.family-edit-summary')).toContainText("drugi roditelj: Mother Demo");
  await page.getByRole("button", { name: "Dodaj u nacrt", exact: true }).click();
  await expect(page.locator("#person-detail-name")).toHaveText("Disconnected Demo");
  await page.locator("#people-close").click();
  const expected = structuredClone(before);
  expected.find(person => person.id === "near-father").rels.children.push("near-disconnected");
  expected.find(person => person.id === "near-mother").rels.children.push("near-disconnected");
  expected.find(person => person.id === "near-disconnected").rels.parents.push("near-father", "near-mother");
  expect(await draftFictionalNodes(page)).toEqual(expected);
  expect(await savedFictionalNodes(page)).toEqual(before);
  expect(await editionBytes()).toEqual(edition);
  page.once("dialog", dialog => dialog.accept());
  await page.locator("#discard-button").click();
  await expect(page.locator("#save-button")).toBeHidden();
});

test("nearest family shows parents, partners, siblings and children and a Save preserves every hidden branch", async ({ page }) => {
  await unlock(page);
  const before = await savedFictionalNodes(page);
  const focusFamily = ["Focus Demo", "Father Demo", "Mother Demo", "PartnerOne Demo", "PartnerTwo Demo", "Sibling Demo",
    "HalfOne Demo", "HalfTwo Demo", "ChildOne Demo", "ChildTwo Demo", "ChildThree Demo"];
  await personProfile(page, "Focus Demo");
  await expect(page.locator('#person-detail section[aria-label="Braća i sestre"] .person-link strong')).toHaveText(["Sibling Demo", "HalfOne Demo", "HalfTwo Demo"]);
  await page.getByRole("button", { name: "Pokaži u stablu", exact: true }).click();
  await expectChartPeople(page, focusFamily);
  await page.getByRole("button", { name: "Otvori osobu: Father Demo", exact: true }).click();
  await page.locator("#people-close").click();
  await expectChartPeople(page, ["Father Demo", "Grandparent Demo", "Mother Demo", "Uncle Demo", "Focus Demo", "Sibling Demo", "HalfOne Demo"]);
  await personProfile(page, "ChildOne Demo");
  await page.getByRole("button", { name: "Pokaži u stablu", exact: true }).click();
  await expectChartPeople(page, ["ChildOne Demo", "Focus Demo", "PartnerOne Demo", "ChildPartner Demo", "Grandchild Demo", "ChildTwo Demo", "ChildThree Demo"]);
  await personProfile(page, "CoParent Demo");
  await page.getByRole("button", { name: "Pokaži u stablu", exact: true }).click();
  await expectChartPeople(page, ["CoParent Demo", "ChildThree Demo"]);
  await personProfile(page, "Disconnected Demo");
  await page.getByRole("button", { name: "Pokaži u stablu", exact: true }).click();
  await expectChartPeople(page, ["Disconnected Demo"]);
  expect(await savedFictionalNodes(page)).toEqual(before);
  await personProfile(page, "Focus Demo");
  await page.getByRole("button", { name: "Pokaži u stablu", exact: true }).click();
  await editDate(page, "Fictional nearest-family edited birth");
  await page.locator("#save-button").click();
  await expect(page.locator("#tree-status")).toContainText("Saved and verified");
  const expected = structuredClone(before);
  expected.find(person => person.id === "near-focus").data.birthday = "Fictional nearest-family edited birth";
  expect(await savedFictionalNodes(page)).toEqual(expected);
  const encrypted = await (await page.request.get("/data/family.enc.json")).json();
  expect(await decryptFamily(encrypted, PASSWORD)).toEqual(expected);
  await unlock(page);
  await personProfile(page, "Focus Demo");
  await page.getByRole("button", { name: "Pokaži u stablu", exact: true }).click();
  await expectChartPeople(page, focusFamily);
});

test("public nearest family cannot bridge a private parent and opens further generations on demand", async ({ page }) => {
  const nodes = JSON.parse(await readFile(new URL("../fixtures/family/valid-nearest-family.json", import.meta.url), "utf8"));
  const hidden = new Set(["near-mother", "near-partner-two", "near-coparent"]);
  for (const person of nodes) if (!hidden.has(person.id)) person.privacy = { publicAnchor: true, publicLabel: "Approved " + person.data["first name"] };
  const { catalog } = buildPublicAnchorArtifacts(nodes);
  const privateRequests = [];
  page.on("request", request => { if (/family\.enc\.json|\/api\/(session|save|media)/.test(request.url())) privateRequests.push(request.url()); });
  await page.route("**/data/family.anchors.public.json", route => route.fulfill({ contentType: "application/json", body: JSON.stringify(catalog) }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/family-preview/");
  await page.locator("#public-tree-button").click();
  await personProfile(page, "Approved Focus");
  await expect(page.locator('#person-detail section[aria-label="Braća i sestre"] .person-link strong')).toHaveText(["Approved HalfOne", "Approved Sibling"]);
  await page.getByRole("button", { name: "Pokaži u stablu", exact: true }).click();
  await expectChartPeople(page, ["Approved Focus", "Approved Father", "Approved PartnerOne", "Approved Sibling", "Approved HalfOne",
    "Approved ChildOne", "Approved ChildTwo", "Approved ChildThree"]);
  await personProfile(page, "Approved ChildOne");
  await page.getByRole("button", { name: "Pokaži u stablu", exact: true }).click();
  await expectChartPeople(page, ["Approved ChildOne", "Approved Focus", "Approved PartnerOne", "Approved ChildPartner", "Approved Grandchild",
    "Approved ChildTwo", "Approved ChildThree"]);
  await expect(page.locator("#edit-button")).toBeHidden();
  await expect(page.locator("body")).not.toContainText("Demo");
  await expect(page.locator("body")).not.toContainText("Approved Mother");
  expect(privateRequests).toEqual([]);
});

test("phone search and profiles show recorded birth years and navigate parents and children", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await unlock(page, "/family-preview/");
  await page.locator("#people-button").click();
  await page.locator("#people-search").fill("does-not-exist");
  await expect(page.locator("#people-results")).toContainText("Nema rezultata.");
  await page.locator("#people-search").fill("example parent 1970");
  await page.locator("#people-results .person-link").click();
  await expect(page.locator("#person-detail-name")).toHaveText("Parent Example");
  await expect(page.locator("#person-detail .person-birth")).toHaveText("Rođenje: 1970");
  await page.locator('#person-detail section[aria-label="Djeca"] .person-link').click();
  await expect(page.locator("#person-detail-name")).toHaveText("Child Example");
  await expect(page.locator("#person-detail .person-birth")).toHaveText("Rođenje: 2000");
  await page.locator('#person-detail section[aria-label="Roditelji"] .person-link').click();
  await expect(page.locator("#person-detail-name")).toHaveText("Parent Example");
  await page.locator('#person-detail section[aria-label="Roditelji"] .person-link').click();
  await expect(page.locator("#person-detail-name")).toHaveText("Grand Example");
  const layout = await page.locator("#people-dialog").evaluate(dialog => {
    const input = dialog.querySelector("input");
    return { fits: dialog.getBoundingClientRect().left >= 0 && dialog.getBoundingClientRect().right <= innerWidth,
      overflow: dialog.scrollWidth > dialog.clientWidth, fontSize: getComputedStyle(input).fontSize };
  });
  expect(layout).toEqual({ fits: true, overflow: false, fontSize: "16px" });
  await page.getByRole("button", { name: "Pokaži u stablu", exact: true }).click();
  await expect(page.getByRole("button", { name: "Otvori osobu: Grand Example", exact: true })).toBeVisible();
});

test("mobile profile sheet keeps the tree visible and preserves unfinished fields when returning to search", async ({ page }, testInfo) => {
  const before = await editionBytes();
  await page.setViewportSize({ width: 390, height: 844 });
  await unlock(page);
  await personProfile(page, "Alex Example");
  await expect(page.locator("#person-detail-name")).toBeInViewport();
  await expect(page.locator("#people-search")).toBeHidden();
  await expect(page.locator("#people-back")).toBeVisible();
  const layout = await page.locator("#people-dialog").evaluate(dialog => {
    const box = dialog.getBoundingClientRect();
    return { leavesTreeVisible: box.top >= innerHeight * 0.2, reachesBottom: Math.abs(box.bottom - innerHeight) <= 1,
      overflow: dialog.scrollWidth > dialog.clientWidth + 1,
      closeHeight: dialog.querySelector("#people-close").getBoundingClientRect().height };
  });
  expect(layout).toEqual({ leavesTreeVisible: true, reachesBottom: true, overflow: false, closeHeight: 44 });
  const previewFits = () => page.locator('#family-chart [aria-label="Otvori osobu: Alex Example"]').evaluate(card => {
    const box = card.getBoundingClientRect(), sheet = document.querySelector("#people-dialog").getBoundingClientRect();
    return box.top >= 0 && box.bottom <= sheet.top && box.height > 0;
  });
  await expect.poll(previewFits).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("mobilni-profil.png"), animations: "disabled" });
  await page.setViewportSize({ width: 390, height: 568 });
  await expect.poll(previewFits).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".person-edit summary").click();
  const notes = page.locator('.person-profile-form textarea[name="notes"]');
  const draft = "Fictional mobile profile draft not yet applied";
  await notes.fill(draft);
  let dialogs = 0, acceptNavigation = false;
  page.on("dialog", async dialog => { dialogs++; await (acceptNavigation ? dialog.accept() : dialog.dismiss()); });
  await page.locator("#people-back").click();
  await expect(page.locator("#people-search")).toBeFocused();
  await expect(page.locator("#person-detail")).toBeHidden();
  await page.locator("#people-search").fill("Alex Example");
  await page.locator("#people-results .person-link").click();
  await expect(notes).toHaveValue(draft);
  expect(dialogs).toBe(0);
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.locator("#people-search")).toBeVisible();
  await expect(page.locator("#people-back")).toBeHidden();
  await expect(notes).toHaveValue(draft);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#people-back").click();
  await page.locator("#people-search").fill("Blair Example");
  await page.locator("#people-results .person-link").click();
  await expect(page.locator("#person-detail-name")).toHaveText("Alex Example");
  await expect(notes).toHaveValue(draft);
  await expect(page.locator("#people-back")).toBeVisible();
  expect(dialogs).toBe(1);
  acceptNavigation = true;
  await page.locator("#people-back").click();
  await page.locator("#people-results .person-link").click();
  await expect(page.locator("#person-detail-name")).toHaveText("Blair Example");
  expect(dialogs).toBe(2);
  const originalBirth = await page.locator("#person-detail .person-birth").textContent();
  await page.getByRole("button", { name: "Pokaži u stablu", exact: true }).click();
  await editDate(page, "Fictional updated sheet birth");
  await page.locator('#family-chart form.f3-form button[type="submit"]').click();
  await personProfile(page, "Blair Example");
  await expect(page.locator("#person-detail .person-birth")).toHaveText("Rođenje: Fictional updated sheet birth");
  await page.locator("#people-close").click();
  await page.locator("#discard-button").click();
  await personProfile(page, "Blair Example");
  await expect(page.locator("#person-detail .person-birth")).toHaveText(originalBirth);
  await page.locator("#people-close").click();
  await expect(page.locator("#save-button")).toBeHidden();
  expect(await editionBytes()).toEqual(before);
});

test("search navigation preserves an unfinished editor draft and Discard restores the saved search data", async ({ page }) => {
  await unlock(page);
  await editDate(page, "Fictional preserved navigation draft");
  await page.locator("#people-button").click();
  await page.locator("#people-search").fill("Parent Example 1970");
  await page.locator("#people-results .person-link").click();
  await page.getByRole("button", { name: "Pokaži u stablu", exact: true }).click();
  await expect(page.locator('#family-chart input[name="birthday"]')).toHaveValue("1970");
  await expect(page.locator("#save-button")).toBeEnabled();
  await page.locator("#people-button").click();
  await page.locator("#people-search").fill("Fictional preserved navigation draft");
  await expect(page.locator("#people-results .person-link")).toHaveCount(1);
  await page.locator("#people-close").click();
  page.once("dialog", dialog => dialog.accept());
  await page.locator("#discard-button").click();
  await page.locator("#people-button").click();
  await page.locator("#people-search").fill("Fictional preserved navigation draft");
  await expect(page.locator("#people-results .person-link")).toHaveCount(0);
});

test("read-only viewing searches and browses relatives without a local save API", async ({ page }) => {
  await page.route("**/api/status", route => route.fulfill({ status: 404, body: "Not Found", contentType: "text/plain" }));
  await page.route("**/assets/site-config.js", route => route.fulfill({ contentType: "text/javascript",
    body: 'window.FAMILY_TREE_CONFIG = { suggestionsApiUrl: "https://fictional-cloud.invalid/suggestions" };' }));
  await page.goto("/family-preview/");
  await openAdminAccess(page);
  await page.locator("#password").fill(PASSWORD);
  await page.locator("#unlock-button").click();
  await expect(page.locator("#tree-shell")).toBeVisible();
  await expect(page.locator("#edit-button")).toBeHidden();
  await expect(page.locator("#suggest-button, #admin-review-button")).toHaveCount(2);
  await expect(page.locator("#suggest-button")).toBeHidden();
  await expect(page.locator("#admin-review-button")).toBeHidden();
  await page.locator("#people-button").click();
  await page.locator("#people-search").fill("Parent Example 1970");
  await page.locator("#people-results .person-link").click();
  await page.locator('#person-detail section[aria-label="Djeca"] .person-link').click();
  await expect(page.locator("#person-detail-name")).toHaveText("Child Example");
  await page.locator("#relationship-set-reference").click();
  await page.locator('#person-detail section[aria-label="Roditelji"] .person-link').click();
  await expect(page.locator(".relationship-status")).toHaveText("Roditelj početne osobe.");
  await page.locator('#person-detail section[aria-label="Djeca"] .person-link').click();
  await page.getByRole("button", { name: "Pokaži u stablu", exact: true }).click();
  await expect(page.getByRole("button", { name: "Otvori osobu: Child Example", exact: true })).toBeVisible();
  await expect(page.locator("#save-button")).toBeHidden();
});

test("public visitors see only approved labels without fetching or unlocking the private tree", async ({ page }) => {
  const privateRequests = [];
  page.on("request", request => {
    if (request.url().includes("/family.enc.json") || /\/api\/(session|save)/.test(request.url())) privateRequests.push(request.url());
  });
  await page.goto("/family-preview/");
  await page.locator("#public-people-title").click();
  await expect(page.locator("#public-results li")).toHaveCount(1);
  await expect(page.locator("#public-results")).toContainText("Reviewed Public Label");
  await expect(page.locator("#public-results")).toContainText("1901–1999");
  await expect(page.locator("#public-results")).toContainText("Example branch");
  await expect(page.locator("body")).not.toContainText("PrivateOnlyFirst");
  await expect(page.locator("body")).not.toContainText("NeverPublic");
  await expect(page.locator("body")).not.toContainText("1901-02-03");
  await expect(page.locator("body")).not.toContainText("Grand Example");
  await expect(page.locator("#tree-shell")).toBeHidden();
  await expect(page.locator("#edit-button")).toBeHidden();
  await page.locator("#public-search").fill("NeverPublic");
  await expect(page.locator("#public-results li")).toHaveCount(0);
  await expect(page.locator("#public-status")).toContainText("Nema rezultata.");
  await page.locator("#public-search").fill("1901");
  await expect(page.locator("#public-results li")).toHaveCount(1);
  const result = page.getByRole("button", { name: "Otvori javni profil: Reviewed Public Label", exact: true });
  await result.focus();
  await result.press("Enter");
  await expect(page.locator("#person-detail-name")).toHaveText("Reviewed Public Label");
  await expect(page.locator("#person-detail .person-birth")).toHaveText("Javne godine: 1901–1999");
  await expect(page.locator("#edit-button")).toBeHidden();
  await page.getByRole("button", { name: "Pokaži u stablu", exact: true }).click();
  await expect(page.getByRole("button", { name: "Otvori osobu: Reviewed Public Label", exact: true })).toBeVisible();
  expect(privateRequests).toEqual([]);
});

test("a failed public catalog keeps private records hidden and cannot break password unlock", async ({ page }) => {
  await page.route("**/data/family.anchors.public.json", route => route.fulfill({ status: 404, body: "Not Found", contentType: "text/plain" }));
  await page.goto("/");
  await expect(page.locator("#public-retry")).toBeVisible();
  await expect(page.locator("#public-results li")).toHaveCount(0);
  await expect(page.locator("#public-status")).toContainText("trenutačno ne mogu učitati");
  await expect(page.locator("#public-search")).toBeDisabled();
  await openAdminAccess(page);
  await page.locator("#password").fill(PASSWORD);
  await page.locator("#unlock-button").click();
  await expect(page.locator("#tree-shell")).toBeVisible();
  await expect(page.locator("#edit-button")).toBeVisible();
});

test("an empty public catalog stays empty and public HTML-like labels remain text on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let labels = [];
  await page.route("**/data/family.anchors.public.json", async route => {
    const response = await route.fetch();
    const catalog = await response.json();
    await route.fulfill({ response, json: { ...catalog, anchors: labels } });
  });
  await page.goto("/");
  await expect(page.locator("#public-status")).toHaveText("Još nema odobrenih javnih podataka.");
  await expect(page.locator("#public-results li")).toHaveCount(0);
  const label = '<img src=x onerror="window.publicInjected=true"> Fictional';
  labels = [{ id: "fictional-reviewed", displayLabel: label, lifespanLabel: "oko 1900", branchLabel: "Example branch" }];
  await page.reload();
  await page.locator("#public-people-title").click();
  await expect(page.locator("#public-results strong")).toHaveText(label);
  await expect(page.locator("#public-results img")).toHaveCount(0);
  expect(await page.evaluate(() => ({ injected: window.publicInjected === true,
    overflow: document.documentElement.scrollWidth > innerWidth,
    fontSize: getComputedStyle(document.querySelector("#public-search")).fontSize })))
    .toEqual({ injected: false, overflow: false, fontSize: "16px" });
});

test("a private-network HTTPS visitor can unlock, edit, save and lock an isolated fictional tree", async ({ browser }) => {
  const { networkInterfaces } = await import("node:os");
  const host = Object.values(networkInterfaces()).flat().find(address => address?.family === "IPv4" && !address.internal
    && /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(address.address))?.address;
  test.skip(!host, "No private IPv4 interface is available for the real HTTPS network test.");
  const { createProject, fixture } = await import("../helpers/project.mjs");
  const { createLocalServer } = await import("../../scripts/local-server.mjs");
  const cleanups = [];
  let server;
  let context;
  try {
    const nodes = await fixture("valid-public-anchor.json");
    for (const person of nodes) person.data.avatar = "";
    const { paths } = await createProject({ after: cleanup => cleanups.push(cleanup) }, { site: true, nodes });
    ({ server } = await createLocalServer({ root: paths.root, environment: "test", host, tls: {
      cert: await readFile(new URL("../fixtures/tls/fictional.cert.pem", import.meta.url)),
      key: await readFile(new URL("../fixtures/tls/fictional.key.pem", import.meta.url))
    } }));
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, host, resolve); });
    const origin = "https://" + host + ":" + server.address().port;
    // This certificate is a public test fixture. Only this isolated context
    // accepts it; the browser still requires a real HTTPS secure context.
    context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 390, height: 844 } });
    await context.route("**/*", route => {
      if (new URL(route.request().url()).origin === origin) return route.continue();
      unexpectedRequests.push(route.request().url());
      return route.abort("blockedbyclient");
    });
    const page = await context.newPage();
    await page.goto(origin);
    await expect(page.locator("#public-results li")).toHaveCount(1);
    expect(await page.evaluate(() => isSecureContext && Boolean(crypto.subtle))).toBe(true);
    await openAdminAccess(page);
    await page.locator("#password").fill("wrong-fictional-password");
    await page.locator("#unlock-button").click();
    await expect(page.locator("#status-message")).toContainText("Unable to unlock");
    await expect(page.locator("#tree-shell")).toBeHidden();
    await page.locator("#password").fill(PASSWORD);
    await page.locator("#unlock-button").click();
    await expect(page.locator("#edit-button")).toBeVisible();
    await page.locator("#edit-button").click();
    await page.locator('#family-chart input[name="birthday"]').fill("Fictional HTTPS mobile edit");
    await page.locator("#save-button").click();
    await expect(page.locator("#tree-status")).toContainText("Saved and verified");
    const saved = JSON.parse(await readFile(paths.canonical, "utf8"));
    expect(saved[0].data.birthday).toBe("Fictional HTTPS mobile edit");
    await page.locator("#clear-session").click();
    await expect(page.locator("#tree-shell")).toBeHidden();
    await expect(page.locator("#public-results li")).toHaveCount(1);
    await expect(page.locator("body")).not.toContainText("Fictional HTTPS mobile edit");
  } finally {
    if (context) await context.close();
    if (server?.listening) {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
    for (const cleanup of cleanups) await cleanup();
  }
});

test("public graph and profiles use only approved labels and links without unlocking private data", async ({ page }) => {
  const privateRequests = [];
  page.on("request", request => {
    if (request.url().includes("/family.enc.json") || /\/api\/(session|save)/.test(request.url())) privateRequests.push(request.url());
  });
  await page.route("**/data/family.anchors.public.json", async route => {
    const response = await route.fetch();
    const catalog = await response.json();
    await route.fulfill({ response, json: { ...catalog, anchors: [
      { id: "public-child", displayLabel: "Reviewed child" },
      { id: "public-parent", displayLabel: "Reviewed parent", lifespanLabel: "oko 1950" }
    ], relationships: [{ from: "public-parent", to: "public-child", type: "parentOf" }] } });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/family-preview/");
  await page.locator("#public-tree-button").click();
  await expect(page.locator("#tree-shell")).toBeVisible();
  await expect(page.locator("#tree-session-label")).toContainText("Javni pregled");
  await expect(page.locator(".personal-tree-card")).toHaveCount(2);
  await expect(page.locator("#edit-button")).toBeHidden();
  await expect(page.locator("#save-button")).toBeHidden();
  await expect(page.locator("#admin-review-button")).toBeHidden();
  await page.locator("#people-button").click();
  await page.locator("#people-search").fill("Reviewed parent");
  await page.locator("#people-results .person-link").click();
  await expect(page.locator("#person-detail .person-birth")).toHaveText("Javne godine: oko 1950");
  await expect(page.locator("#people-search")).toBeHidden();
  const sheet = await page.locator("#people-dialog").evaluate(dialog => {
    const box = dialog.getBoundingClientRect();
    return { leavesTreeVisible: box.top >= innerHeight * 0.2, reachesBottom: Math.abs(box.bottom - innerHeight) <= 1 };
  });
  expect(sheet).toEqual({ leavesTreeVisible: true, reachesBottom: true });
  await expect(page.locator(".person-privacy")).toHaveCount(0);
  await page.locator('#person-detail section[aria-label="Djeca"] .person-link').click();
  await expect(page.locator("#person-detail-name")).toHaveText("Reviewed child");
  await expect(page.locator("#person-detail .person-birth")).toHaveText("Godine nisu javno navedene.");
  await page.locator("#people-close").click();
  await page.locator("#clear-session").click();
  await expect(page.locator("#lock-screen")).toBeVisible();
  expect(privateRequests).toEqual([]);
});

test("unapplied public settings survive cancelled navigation and a reload asks before discarding them", async ({ page }) => {
  await unlock(page);
  await page.locator("#people-button").click();
  await page.locator("#people-search").fill("NeverPublic Person");
  await page.locator("#people-results .person-link").click();
  await page.locator(".person-privacy summary").click();
  await page.locator('input[name="publicAnchor"]').check();
  await page.locator('input[name="publicLabel"]').fill("Fictional unapplied label");
  page.once("dialog", dialog => dialog.dismiss());
  await page.locator("#people-close").click();
  await expect(page.locator("#people-dialog")).toBeVisible();
  await expect(page.locator('input[name="publicLabel"]')).toHaveValue("Fictional unapplied label");
  await page.locator("#people-search").fill("Parent Example 1970");
  page.once("dialog", dialog => dialog.dismiss());
  await page.locator("#people-results .person-link").click();
  await expect(page.locator("#person-detail-name")).toHaveText("NeverPublic Person");
  await expect(page.locator('input[name="publicLabel"]')).toHaveValue("Fictional unapplied label");
  const warning = page.waitForEvent("dialog");
  const reloading = page.reload();
  const dialog = await warning;
  expect(dialog.type()).toBe("beforeunload");
  await dialog.accept();
  await reloading;
  await expect(page.locator("#lock-screen")).toBeVisible();
  await expect(page.locator("#public-results")).not.toContainText("Fictional unapplied label");
});

test("privacy drafts require reviewed saving and withdrawing a person removes public links without changing the family graph", async ({ page }) => {
  await unlock(page);
  async function profile(query) {
    if (!await page.locator("#people-dialog").isVisible()) await page.locator("#people-button").click();
    await page.locator("#people-search").fill(query);
    await page.locator("#people-results .person-link").click();
    await page.locator(".person-privacy summary").click();
  }
  await profile("Grand Example 1940");
  await page.locator('input[name="publicAnchor"]').check();
  await page.locator('input[name="publicLabel"]').fill("Reviewed public elder");
  await page.locator('input[name="publicLifespan"]').fill("1940");
  await page.getByRole("button", { name: "Primijeni u nacrt", exact: true }).click();
  await expect(page.locator("#person-privacy-status")).toContainText("Postavke su u nacrtu");
  await profile("Parent Example 1970");
  await page.locator('input[name="publicAnchor"]').check();
  await page.locator('input[name="publicLabel"]').fill("Reviewed public middle");
  await page.getByRole("button", { name: "Primijeni u nacrt", exact: true }).click();
  await page.locator("#people-close").click();
  let reviewText;
  page.once("dialog", dialog => { reviewText = dialog.message(); return dialog.dismiss(); });
  await page.locator("#save-button").click();
  await expect(page.locator("#tree-status")).toContainText("Public changes were cancelled");
  expect(reviewText).toContain("Add relationship: Reviewed public elder → dijete: Reviewed public middle");
  const unchanged = await (await fetch(ORIGIN + "/data/family.anchors.public.json")).json();
  expect(unchanged.anchors).toHaveLength(1);
  expect(unchanged.relationships).toEqual([]);
  page.once("dialog", dialog => dialog.accept());
  await page.locator("#save-button").click();
  await expect(page.locator("#tree-status")).toContainText("Saved and verified");
  await page.locator("#clear-session").click();
  await expect(page.locator("#public-results li")).toHaveCount(3);
  await page.locator("#public-tree-button").click();
  await page.locator("#people-button").click();
  await page.locator("#people-search").fill("Reviewed public middle");
  await page.locator("#people-results .person-link").click();
  await expect(page.locator("#person-detail .person-birth")).toHaveText("Godine nisu javno navedene.");
  await expect(page.locator('#person-detail section[aria-label="Roditelji"]')).toContainText("Reviewed public elder");
  await expect(page.locator('#person-detail section[aria-label="Djeca"]')).toContainText("Nema javno prikazanih veza.");
  await expect(page.locator("body")).not.toContainText("Child Example");
  await page.locator("#people-close").click();
  await page.locator("#clear-session").click();
  await unlock(page);
  await profile("Parent Example 1970");
  await page.locator('input[name="publicAnchor"]').uncheck();
  await page.getByRole("button", { name: "Primijeni u nacrt", exact: true }).click();
  await page.locator("#people-close").click();
  page.once("dialog", dialog => { reviewText = dialog.message(); return dialog.accept(); });
  await page.locator("#save-button").click();
  await expect(page.locator("#tree-status")).toContainText("Saved and verified");
  expect(reviewText).toContain("Remove relationship:");
  const published = await (await fetch(ORIGIN + "/data/family.anchors.public.json")).json();
  expect(published.anchors.some(person => person.id === "parent")).toBe(false);
  expect(published.relationships).toEqual([]);
  const status = await (await fetch(ORIGIN + "/api/status")).json();
  const session = await (await fetch(ORIGIN + "/api/session", { method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/json", "X-Family-Local-Token": status.csrfToken },
    body: JSON.stringify({ password: PASSWORD, payloadDigest: status.payloadDigest }) })).json();
  const middle = session.nodes.find(person => person.id === "parent");
  expect(middle.rels).toEqual({ parents: ["grandparent"], children: ["child"], spouses: [] });
  expect(middle.data.birthday).toBe("1970");
});

async function fictionalPhotos(page, colors = ["#bf2638", "#2455ba"]) {
  const encoded = await page.evaluate(colors => colors.map(color => {
    const canvas = document.createElement("canvas"); canvas.width = 1200; canvas.height = 600;
    const context = canvas.getContext("2d"); context.fillStyle = color; context.fillRect(0, 0, 1200, 600);
    return canvas.toDataURL("image/png").split(",")[1];
  }), colors);
  return encoded.map((content, index) => ({ name: "fictional-" + index + ".png", mimeType: "image/png", buffer: Buffer.from(content, "base64") }));
}

test("expanded profiles preserve aliases, residences, notes and private photo originals through Save and Lock", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await unlock(page);
  const images = await fictionalPhotos(page);
  await page.locator("#people-button").click();
  await page.locator("#people-search").fill("NeverPublic Person");
  await page.locator("#people-results .person-link").click();
  await page.locator(".person-edit summary").click();
  const form = page.locator(".person-profile-form");
  await form.locator('input[name="maiden name"]').fill("Fictional Čović");
  await form.locator('textarea[name="previous names"]').fill("Fictional former name\nAnother former name");
  await form.locator('input[name="nicknames"]').fill("Žućo, Dida");
  await form.locator('input[name="birthplace"]').fill("Fictional birthplace");
  const notes = 'Occupation, source and a story\n<img src=x onerror="window.profileInjected=true">';
  await form.locator('textarea[name="notes"]').fill(notes);
  await page.getByRole("button", { name: "Dodaj mjesto života", exact: true }).click();
  await page.locator('.residence-row [data-residence="place"]').fill("Fictional first town");
  await page.locator('.residence-row [data-residence="from"]').fill("oko 1980");
  await page.locator('.residence-row [data-residence="to"]').fill("1995");
  await page.getByRole("button", { name: "Dodaj mjesto života", exact: true }).click();
  await page.locator('.residence-row [data-residence="place"]').nth(1).fill("Fictional second town");
  await page.locator('.residence-row [data-residence="from"]').nth(1).fill("1995");
  await page.locator('.residence-row [data-residence="to"]').nth(1).fill("i danas");
  await page.locator(".person-photos-editor summary").click();
  await form.locator('input[name="main-photo"]').setInputFiles(images[0]);
  await expect(page.locator(".photo-editor-item")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Primijeni u nacrt", exact: true })).toBeEnabled();
  await form.locator('input[name="gallery-photos"]').setInputFiles(images[1]);
  await expect(page.locator(".photo-editor-item")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Primijeni u nacrt", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Primijeni u nacrt", exact: true }).click();
  await expect(page.locator("#person-privacy-status")).toContainText("u nacrtu");
  await page.getByRole("button", { name: "Pokaži u stablu", exact: true }).click();
  await page.locator("#save-button").click();
  await expect(page.locator("#tree-status")).toContainText("Saved and verified");
  await expect.poll(() => page.locator("#family-chart .personal-tree-avatar").evaluateAll(images => images.some(image => image.complete && image.naturalWidth > 0))).toBe(true);
  await page.locator("#people-button").click();
  await page.locator("#people-search").fill("zuco covic");
  await page.locator("#people-results .person-link").click();
  await expect(page.locator("#person-detail")).toContainText("Fictional first town · oko 1980 — 1995");
  await expect(page.locator("#person-detail")).toContainText(notes);
  expect(await page.evaluate(() => window.profileInjected === true)).toBe(false);
  await expect(page.locator(".person-gallery .photo-tile")).toHaveCount(2);
  await page.locator(".person-gallery .photo-tile").first().click();
  await expect(page.locator(".photo-dialog[open]")).toBeVisible();
  const downloading = page.waitForEvent("download");
  await page.getByRole("link", { name: "Preuzmi izvornu fotografiju" }).click();
  const download = await downloading;
  expect(await readFile(await download.path())).toEqual(images[0].buffer);
  await page.getByRole("button", { name: "Zatvori fotografiju", exact: true }).click();
  await page.locator("#people-close").click();
  await page.locator("#clear-session").click();
  await expect(page.locator(".person-gallery, .photo-dialog")).toHaveCount(0);
  await expect(page.locator("#public-results")).not.toContainText("Fictional Čović");
  await page.locator("#public-tree-button").click();
  await expect(page.locator("#edit-button")).toBeHidden();
  await expect(page.locator("#family-chart .personal-tree-avatar")).toHaveCount(0);
});

test("failed upload and failed saving retain profile text and staged photos for retry", async ({ page }) => {
  await unlock(page);
  const [image] = await fictionalPhotos(page);
  await page.locator("#people-button").click();
  await page.locator("#people-search").fill("Parent Example 1970");
  await page.locator("#people-results .person-link").click();
  await page.locator(".person-edit summary").click();
  await page.locator('.person-profile-form textarea[name="notes"]').fill("Fictional preserved profile draft");
  await page.locator(".person-photos-editor summary").click();
  await page.route("**/api/media/upload", route => route.fulfill({ status: 500, contentType: "application/json",
    body: JSON.stringify({ code: "MEDIA_FAILED", message: "Fictional upload failure" }) }));
  await page.locator('input[name="main-photo"]').setInputFiles(image);
  await expect(page.locator(".person-photos-editor")).toContainText("Fictional upload failure");
  await expect(page.locator('.person-profile-form textarea[name="notes"]')).toHaveValue("Fictional preserved profile draft");
  await page.unroute("**/api/media/upload");
  await page.locator('input[name="main-photo"]').setInputFiles(image);
  await expect(page.locator(".photo-editor-item")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Primijeni u nacrt", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Primijeni u nacrt", exact: true }).click();
  await page.locator("#people-close").click();
  await page.route("**/api/save", route => route.fulfill({ status: 500, contentType: "application/json",
    body: JSON.stringify({ code: "SAVE_FAILED", message: "Fictional profile save failure" }) }));
  await page.locator("#save-button").click();
  await expect(page.locator("#tree-status")).toContainText("Fictional profile save failure");
  await page.locator("#people-button").click();
  await page.locator("#people-search").fill("Parent Example 1970");
  await page.locator("#people-results .person-link").click();
  await expect(page.locator("#person-detail")).toContainText("Fictional preserved profile draft");
  await expect(page.locator(".person-gallery .photo-tile")).toHaveCount(1);
  await page.locator("#people-close").click();
  await page.unroute("**/api/save");
  await page.locator("#save-button").click();
  await expect(page.locator("#tree-status")).toContainText("Saved and verified");
});

const SUBMISSION_CODE = "fictional-browser-submission-code";
async function configureLocalCode(page, code = SUBMISSION_CODE) {
  await page.locator("#admin-review-button").click();
  await expect(page.locator("#admin-workspace")).toBeVisible();
  if (!await page.locator("#local-submission-code").isVisible()) await page.locator("#local-suggestion-settings summary").click();
  await page.locator("#local-submission-code").fill(code);
  await page.locator('#local-code-form button[type="submit"]').click();
  await expect(page.locator("#local-suggestion-settings summary")).toContainText("uključen");
  await expect(page.locator("#local-submission-code")).toHaveValue("");
}
async function editionBytes() {
  return Promise.all(["/data/family.enc.json", "/data/family.anchors.public.json"].map(async file => (await fetch(ORIGIN + file)).text()));
}

test("owner configures a code on a phone, guest text survives failure, and private review stays safe", async ({ page }) => {
  const before = await editionBytes();
  await page.setViewportSize({ width: 390, height: 844 });
  await unlock(page);
  await configureLocalCode(page);
  await page.locator("#admin-sign-out").click();
  await expect(page.locator("#lock-screen")).toBeVisible();
  await expect(page.locator("#admin-suggestion-list")).toBeEmpty();
  await page.locator("#guest-suggest-button").click();
  const message = 'Fictional missing person <img src=x onerror="window.guestInjected=true">';
  await page.locator("#suggestion-name").fill("Fictional browser visitor");
  await page.locator("#suggestion-message").fill(message);
  await page.locator("#suggestion-code").fill("incorrect-fictional-code");
  await page.locator("#suggestion-submit").click();
  await expect(page.locator("#suggestion-status")).toContainText("code is invalid");
  await expect(page.locator("#suggestion-message")).toHaveValue(message);
  await expect(page.locator("#suggestion-code")).toHaveValue("");
  await page.route("**/api/suggestions", route => route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"Submission failed"}' }));
  await page.locator("#suggestion-code").fill(SUBMISSION_CODE);
  await page.locator("#suggestion-submit").click();
  await expect(page.locator("#suggestion-status")).toContainText("Unable to send");
  await expect(page.locator("#suggestion-name")).toHaveValue("Fictional browser visitor");
  await expect(page.locator("#suggestion-message")).toHaveValue(message);
  await page.unroute("**/api/suggestions");
  await page.locator("#suggestion-code").fill(SUBMISSION_CODE);
  await page.locator("#suggestion-submit").click();
  await expect(page.locator("#suggestion-status")).toContainText("sent for review");
  await expect(page.locator("#suggestion-code")).toHaveValue("");
  await expect(page.locator("#suggestion-message")).toHaveValue("");
  await expect(page.locator("#tree-shell")).toBeHidden();
  await page.locator("#suggestion-close").click();
  await unlock(page);
  await page.locator("#admin-review-button").click();
  await page.locator(".admin-suggestion-item").filter({ hasText: "Fictional browser visitor" }).click();
  await expect(page.locator("#admin-detail-message")).toHaveText(message);
  await expect(page.locator("#admin-detail-message img")).toHaveCount(0);
  expect(await page.evaluate(() => window.guestInjected === true)).toBe(false);
  expect(await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth,
    codeOverflow: document.querySelector("#local-suggestion-settings").scrollWidth > document.querySelector("#local-suggestion-settings").clientWidth + 1 })))
    .toEqual({ overflow: false, codeOverflow: false });
  await page.locator("#admin-review-note").fill("Fictional needs checking");
  await page.locator("#admin-reject").click();
  await expect(page.locator("#admin-review-status")).toContainText("marked rejected");
  await page.locator("#admin-status-filter").selectOption("rejected");
  await page.locator(".admin-suggestion-item").filter({ hasText: "Fictional browser visitor" }).click();
  await expect(page.locator("#admin-review-note")).toHaveValue("Fictional needs checking");
  expect(await editionBytes()).toEqual(before);
  await page.locator("#admin-sign-out").click();
  await expect(page.locator("#admin-detail-message")).toHaveText("");
  expect(await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) })))
    .toEqual({ local: [], session: [] });
});

test("visual approval creates a private draft, a failed Save retains it, and a separate Save persists it", async ({ page }) => {
  const before = await editionBytes();
  await unlock(page);
  const [attachment] = await fictionalPhotos(page);
  await configureLocalCode(page);
  await page.locator("#admin-sign-out").click();
  await page.locator("#guest-suggest-button").click();
  await page.locator("#suggestion-visual-tab").click();
  await page.locator('.visual-anchor-option[data-anchor-id="approved-anchor"]').click();
  await page.locator('[data-visual-add="child"]').click();
  await page.locator("#visual-person-first-name").fill("Fictional proposed child");
  await page.locator("#visual-person-last-name").fill("Visitor");
  await page.locator("#visual-person-birthday").fill("2001");
  await page.locator('#visual-person-form button[type="submit"]').click();
  await page.locator("#visual-preview-button").click();
  await expect(page.locator("#visual-preview-people")).toContainText("Fictional proposed child");
  await page.locator("#visual-preview-continue").click();
  await page.locator("#visual-submitter-name").fill("Fictional visual browser visitor");
  await page.locator("#visual-submitter-code").fill(SUBMISSION_CODE);
  await page.locator('#visual-photo-attachments input[type="file"]').setInputFiles(attachment);
  await expect(page.locator("#visual-photo-attachments .suggestion-photo-item")).toHaveCount(1);
  await page.locator("#visual-submit-button").click();
  await expect(page.locator("#visual-success")).toBeVisible();
  await expect(page.locator("#visual-submitter-code")).toHaveValue("");
  await page.locator("#visual-success-close").click();
  await unlock(page);
  await page.locator("#admin-review-button").click();
  await page.locator("#admin-type-filter").selectOption("graph");
  await page.locator(".admin-suggestion-item").filter({ hasText: "Fictional visual browser visitor" }).click();
  await expect(page.locator("#admin-graph-people")).toContainText("Fictional proposed child");
  await page.locator('[data-admin-graph-mode="overlay"]').click();
  let downloads = 0;
  page.on("download", () => downloads++);
  await expect(page.locator("#admin-accept")).toHaveText("Odobri i dodaj u nacrt");
  await page.locator("#admin-accept").click();
  await expect(page.locator("#admin-review-status")).toContainText("Dopuna je u nacrtu");
  await expect(page.locator("#admin-add-to-draft")).toBeDisabled();
  await page.locator("#admin-photo-list select").selectOption({ label: "Fictional proposed child Visitor · 2001" });
  await page.locator("#admin-photos-to-draft").click();
  await expect(page.locator("#admin-review-status")).toContainText("Fotografije su u privatnom nacrtu");
  expect(downloads).toBe(0);
  expect(await editionBytes()).toEqual(before);
  // Export remains available as an explicit recovery option.
  const downloading = page.waitForEvent("download");
  await page.locator("#admin-download-patch").click();
  const download = await downloading;
  const patch = JSON.parse(await readFile(await download.path(), "utf8"));
  expect(patch.type).toBe("family-additions");
  expect(patch.addPeople).toHaveLength(1);
  expect(patch.addPeople[0].data["first name"]).toBe("Fictional proposed child");
  expect(patch.addRelationships).toEqual([{ from: "approved-anchor", to: patch.addPeople[0].id, type: "parentOf" }]);
  expect(await editionBytes()).toEqual(before);
  await page.locator("#admin-dialog-close").click();
  await expect(page.locator("#save-button")).toBeEnabled();
  await page.locator("#people-button").click();
  await page.locator("#people-search").fill("Fictional proposed child");
  await page.locator("#people-results .person-link").click();
  await expect(page.locator('#person-detail section[aria-label="Roditelji"]')).toContainText("PrivateOnlyLast");
  await expect(page.locator("#person-detail .person-gallery .photo-tile")).toHaveCount(1);
  await page.locator(".person-privacy summary").click();
  await expect(page.locator('input[name="publicAnchor"]')).not.toBeChecked();
  await page.locator("#people-close").click();
  await page.route("**/api/save", route => route.fulfill({ status: 500, contentType: "application/json",
    body: '{"code":"SAVE_FAILED","message":"Fictional staged addition save failure"}' }));
  await page.locator("#save-button").click();
  await expect(page.locator("#tree-status")).toContainText("Fictional staged addition save failure");
  expect(await editionBytes()).toEqual(before);
  await page.locator("#people-button").click();
  await page.locator("#people-search").fill("Fictional proposed child");
  await expect(page.locator("#people-results .person-link")).toHaveCount(1);
  await page.locator("#people-close").click();
  await page.unroute("**/api/save");
  await page.locator("#save-button").click();
  await expect(page.locator("#tree-status")).toContainText("Saved and verified");
  const savedEdition = await editionBytes();
  expect(savedEdition[0]).not.toBe(before[0]);
  expect(JSON.parse(savedEdition[1]).anchors).toEqual(JSON.parse(before[1]).anchors);
  expect(JSON.parse(savedEdition[1]).relationships).toEqual(JSON.parse(before[1]).relationships);
  await page.locator("#clear-session").click();
  await unlock(page);
  await page.locator("#people-button").click();
  await page.locator("#people-search").fill("Fictional proposed child");
  await expect(page.locator("#people-results .person-link")).toHaveCount(1);
});

test("a stale review tab cannot overwrite a decision; code rotation and disabling block guests", async ({ page, context }) => {
  const before = await editionBytes();
  await unlock(page);
  await configureLocalCode(page);
  const submitted = await context.request.post(ORIGIN + "/api/suggestions", { headers: { Origin: ORIGIN }, data: {
    schemaVersion: 1, type: "text", accessCode: SUBMISSION_CODE,
    submitterName: "Fictional concurrent visitor", message: "Fictional two-tab decision" } });
  expect(submitted.status()).toBe(201);
  await page.locator("#admin-refresh").click();
  await page.locator(".admin-suggestion-item").filter({ hasText: "Fictional concurrent visitor" }).click();
  const newer = await context.newPage();
  await unlock(newer);
  await newer.locator("#admin-review-button").click();
  await newer.locator(".admin-suggestion-item").filter({ hasText: "Fictional concurrent visitor" }).click();
  await newer.locator("#admin-reject").click();
  await expect(newer.locator("#admin-review-status")).toContainText("marked rejected");
  await page.locator("#admin-accept").click();
  await expect(page.locator("#admin-review-status")).toContainText("Suggestion changed");
  await newer.close();
  await page.locator("#admin-dialog-close").click();
  const replacement = SUBMISSION_CODE + "-replacement";
  await configureLocalCode(page, replacement);
  const request = code => context.request.post(ORIGIN + "/api/suggestions", { headers: { Origin: ORIGIN }, data: {
    schemaVersion: 1, type: "text", accessCode: code,
    submitterName: "Fictional rotated-code visitor", message: "Fictional replacement code" } });
  expect((await request(SUBMISSION_CODE)).status()).toBe(403);
  expect((await request(replacement)).status()).toBe(201);
  await page.locator("#local-suggestion-settings summary").click();
  await page.locator("#local-disable-submissions").click();
  await expect(page.locator("#local-code-status")).toContainText("isključeno");
  expect((await request(replacement)).status()).toBe(403);
  await page.locator("#admin-sign-out").click();
  await expect(page.locator("#guest-suggest-button")).toBeHidden();
  await page.reload();
  await expect(page.locator("#guest-suggest-button")).toBeHidden();
  expect(await editionBytes()).toEqual(before);
});

async function submitFictionalBranch(context, name) {
  const catalog = await (await fetch(ORIGIN + "/data/family.anchors.public.json")).json();
  const response = await context.request.post(ORIGIN + "/api/suggestions", { headers: { Origin: ORIGIN }, data: {
    schemaVersion: 1, type: "graph", accessCode: SUBMISSION_CODE,
    anchorPersonId: "approved-anchor", anchorCatalogVersion: catalog.catalogVersion, sourceRevision: catalog.sourceRevision,
    submitterName: name, people: [{ id: "tmp_1", firstName: name, lastName: "Example", birthday: "1990", gender: "F" }],
    relationships: [{ from: "approved-anchor", to: "tmp_1", type: "parentOf" }] } });
  expect(response.status()).toBe(201);
  return (await response.json()).id;
}
async function selectAcceptedBranch(page, name) {
  await page.locator("#admin-review-button").click();
  await page.locator("#admin-status-filter").selectOption("accepted");
  await page.locator("#admin-type-filter").selectOption("graph");
  await page.locator(".admin-suggestion-item").filter({ hasText: name }).click();
  await expect(page.locator("#admin-add-to-draft")).toBeEnabled();
}

test("Discard, Reload and Lock keep an approval without silently saving its draft", async ({ page, context }) => {
  const before = await editionBytes();
  const name = "Fictional discardable branch";
  await unlock(page);
  await configureLocalCode(page);
  await submitFictionalBranch(context, name);
  await page.locator("#admin-refresh").click();
  await page.locator(".admin-suggestion-item").filter({ hasText: name }).click();
  await page.locator("#admin-accept").click();
  await expect(page.locator("#admin-review-status")).toContainText("Dopuna je u nacrtu");
  await page.locator("#admin-dialog-close").click();
  page.once("dialog", dialog => dialog.accept());
  await page.locator("#discard-button").click();
  await page.locator("#people-button").click();
  await page.locator("#people-search").fill(name);
  await expect(page.locator("#people-results .person-link")).toHaveCount(0);
  await page.locator("#people-close").click();
  await editDate(page, "Fictional unrelated owner draft");
  await page.locator("#admin-review-button").click();
  await page.locator("#admin-status-filter").selectOption("accepted");
  await page.locator(".admin-suggestion-item").filter({ hasText: name }).click();
  await expect(page.locator("#admin-add-to-draft")).toBeDisabled();
  await expect(page.locator("#admin-accept")).toBeDisabled();
  await page.locator("#admin-dialog-close").click();
  await expect(page.locator('#family-chart input[name="birthday"]')).toHaveValue("Fictional unrelated owner draft");
  page.once("dialog", dialog => dialog.accept());
  await page.locator("#discard-button").click();
  await selectAcceptedBranch(page, name);
  await page.locator("#admin-add-to-draft").click();
  await expect(page.locator("#admin-review-status")).toContainText("Dopuna je u nacrtu");
  await expect(page.locator("#admin-add-to-draft")).toBeDisabled();
  await page.locator("#admin-dialog-close").click();
  page.once("dialog", dialog => dialog.accept());
  await page.reload();
  await expect(page.locator("#lock-screen")).toBeVisible();
  await unlock(page);
  await selectAcceptedBranch(page, name);
  await page.locator("#admin-add-to-draft").click();
  await expect(page.locator("#admin-review-status")).toContainText("Dopuna je u nacrtu");
  await page.locator("#admin-dialog-close").click();
  page.once("dialog", dialog => dialog.dismiss());
  await page.locator("#clear-session").click();
  await expect(page.locator("#save-button")).toBeEnabled();
  page.once("dialog", dialog => dialog.accept());
  await page.locator("#clear-session").click();
  await expect(page.locator("#lock-screen")).toBeVisible();
  await unlock(page);
  await page.locator("#people-button").click();
  await page.locator("#people-search").fill(name);
  await expect(page.locator("#people-results .person-link")).toHaveCount(0);
  expect(await editionBytes()).toEqual(before);
});

test("lost and late approval responses can be recovered without adding a draft after Lock", async ({ page, context }) => {
  const before = await editionBytes();
  await unlock(page);
  await configureLocalCode(page);
  const lost = "Fictional lost approval";
  await submitFictionalBranch(context, lost);
  await page.locator("#admin-refresh").click();
  await page.locator(".admin-suggestion-item").filter({ hasText: lost }).click();
  await page.route("**/api/admin/suggestions/review", async route => { await route.fetch(); await route.abort("failed"); });
  await page.locator("#admin-accept").click();
  await expect(page.locator("#admin-review-status")).toContainText("interrupted");
  await page.unroute("**/api/admin/suggestions/review");
  await page.locator("#admin-dialog-close").click();
  await expect(page.locator("#save-button")).toBeHidden();
  await selectAcceptedBranch(page, lost);
  await page.locator("#admin-add-to-draft").click();
  await expect(page.locator("#admin-review-status")).toContainText("Dopuna je u nacrtu");
  await page.locator("#admin-dialog-close").click();
  page.once("dialog", dialog => dialog.accept());
  await page.locator("#discard-button").click();

  const late = "Fictional late approval";
  await submitFictionalBranch(context, late);
  await page.locator("#admin-review-button").click();
  await page.locator("#admin-status-filter").selectOption("pending");
  await page.locator(".admin-suggestion-item").filter({ hasText: late }).click();
  let releaseResponse, committed;
  const held = new Promise(resolve => { releaseResponse = resolve; });
  const ready = new Promise(resolve => { committed = resolve; });
  await page.route("**/api/admin/suggestions/review", async route => {
    const response = await route.fetch();
    committed();
    await held;
    await route.fulfill({ response });
  });
  await page.locator("#admin-accept").click();
  await ready;
  await page.locator("#admin-sign-out").click();
  await expect(page.locator("#lock-screen")).toBeVisible();
  const delivered = page.waitForResponse(response => response.url().endsWith("/api/admin/suggestions/review"));
  releaseResponse();
  await delivered;
  await page.unroute("**/api/admin/suggestions/review");
  await expect(page.locator("#admin-detail-message")).toHaveText("");
  await expect(page.locator(".personal-tree-card")).toHaveCount(0);
  await unlock(page);
  await page.locator("#people-button").click();
  await page.locator("#people-search").fill(late);
  await expect(page.locator("#people-results .person-link")).toHaveCount(0);
  await page.locator("#people-close").click();
  await selectAcceptedBranch(page, late);
  await page.locator("#admin-add-to-draft").click();
  await expect(page.locator("#admin-review-status")).toContainText("Dopuna je u nacrtu");
  expect(await editionBytes()).toEqual(before);
});

async function personProfile(page, query) {
  if (!await page.locator("#people-dialog").isVisible()) await page.locator("#people-button").click();
  if (!await page.locator("#people-search").isVisible()) await page.locator("#people-back").click();
  await page.locator("#people-search").fill(query);
  await page.locator("#people-results .person-link").click();
}

async function openPublicCorrection(page) {
  await page.locator("#public-tree-button").click();
  await personProfile(page, "Reviewed Public Label");
  await expect(page.locator("#person-suggest-change")).toBeVisible();
  await page.locator("#person-suggest-change").click();
  await expect(page.locator("#profile-change-fields")).toBeVisible();
}

test("public profile corrections keep private fields hidden and require selected owner changes plus a separate Save", async ({ page }) => {
  const before = await editionBytes();
  await page.setViewportSize({ width: 390, height: 844 });
  await unlock(page);
  await configureLocalCode(page);
  await page.locator("#admin-sign-out").click();
  const guestPrivateRequests = [];
  const monitor = request => { if (/family\.enc|\/api\/(session|media|admin)/.test(request.url())) guestPrivateRequests.push(request.url()); };
  page.on("request", monitor);
  await openPublicCorrection(page);
  await expect(page.locator("#profile-change-fields")).toContainText("Reviewed Public Label");
  await expect(page.locator("#suggestion-visual-tab")).toBeHidden();
  expect(await page.locator("[data-proposed-field]").evaluateAll(inputs => inputs.every(input => input.value === ""))).toBe(true);
  await expect(page.locator("#profile-change-fields")).not.toContainText("PrivateOnly");
  await page.locator('[data-profile-field="birthday"]').check();
  await page.locator('[data-proposed-field="birthday"]').fill("Fictional corrected birth 1903");
  await page.locator('[data-profile-field="last name"]').check();
  await page.locator('[data-proposed-field="last name"]').fill("Unselected fictional surname");
  await page.locator('[data-profile-field="notes"]').check();
  const note = 'Fictional new source <img src=x onerror="window.profileInjected=true">';
  await page.locator('[data-proposed-field="notes"]').fill(note);
  await page.locator("#suggestion-name").fill("Fictional profile visitor");
  await page.locator("#suggestion-code").fill("wrong-fictional-code");
  await page.locator("#suggestion-submit").click();
  await expect(page.locator("#suggestion-status")).toContainText("Kod za slanje prijedloga nije valjan");
  await expect(page.locator('[data-proposed-field="birthday"]')).toHaveValue("Fictional corrected birth 1903");
  await expect(page.locator("#suggestion-code")).toHaveValue("");
  page.once("dialog", dialog => dialog.dismiss());
  await page.locator("#suggestion-close").click();
  await expect(page.locator("#profile-change-fields")).toBeVisible();
  expect(await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth,
    fieldOverflow: document.querySelector("#profile-change-fields").scrollWidth > document.querySelector("#profile-change-fields").clientWidth + 1 })))
    .toEqual({ overflow: false, fieldOverflow: false });
  await page.locator("#suggestion-code").fill(SUBMISSION_CODE);
  await page.locator("#suggestion-submit").click();
  await expect(page.locator("#suggestion-status")).toContainText("Ispravka", { ignoreCase: true });
  await expect(page.locator("#suggestion-status")).toContainText("poslan je na pregled");
  expect(guestPrivateRequests).toEqual([]);
  page.off("request", monitor);
  await page.locator("#suggestion-close").click();
  await expect(page.locator("#person-detail-name")).toHaveText("Reviewed Public Label");
  await page.locator("#people-close").click();
  await unlock(page);
  await page.locator("#admin-review-button").click();
  await page.locator(".admin-suggestion-item").filter({ hasText: "Fictional profile visitor" }).click();
  await expect(page.locator("#admin-profile-change")).toContainText("PrivateOnlyLast");
  await expect(page.locator("#admin-profile-change")).toContainText(note);
  await expect(page.locator("#admin-profile-change img")).toHaveCount(0);
  await page.locator('[data-accepted-profile-field="last name"]').uncheck();
  await page.locator('[data-accepted-profile-field="birthday"]').uncheck();
  await page.locator('[data-accepted-profile-field="notes"]').uncheck();
  await expect(page.locator("#admin-accept")).toBeDisabled();
  await page.locator('[data-accepted-profile-field="birthday"]').check();
  await page.locator('[data-accepted-profile-field="notes"]').check();
  await page.locator("#admin-accept").click();
  await expect(page.locator("#admin-review-status")).toContainText("Dopuna je u nacrtu");
  expect(await editionBytes()).toEqual(before);
  await expect(page.locator('[data-accepted-profile-field="last name"]')).not.toBeChecked();
  await expect(page.locator("#admin-download-patch")).toBeHidden();
  await page.locator("#admin-dialog-close").click();
  page.once("dialog", dialog => dialog.accept());
  await page.locator("#discard-button").click();
  await page.locator("#admin-review-button").click();
  await page.locator("#admin-status-filter").selectOption("accepted");
  await page.locator(".admin-suggestion-item").filter({ hasText: "Fictional profile visitor" }).click();
  await page.locator("#admin-add-to-draft").click();
  await expect(page.locator("#admin-review-status")).toContainText("Dopuna je u nacrtu");
  await page.locator("#admin-dialog-close").click();
  await page.route("**/api/save", route => route.fulfill({ status: 500, contentType: "application/json",
    body: '{"code":"SAVE_FAILED","message":"Fictional correction save failure"}' }));
  await page.locator("#save-button").click();
  await expect(page.locator("#tree-status")).toContainText("Fictional correction save failure");
  expect(await editionBytes()).toEqual(before);
  await page.unroute("**/api/save");
  await page.locator("#save-button").click();
  await expect(page.locator("#tree-status")).toContainText("Saved and verified");
  const after = await editionBytes();
  expect(after[0]).not.toBe(before[0]);
  expect(JSON.parse(after[1]).anchors).toEqual(JSON.parse(before[1]).anchors);
  expect(JSON.parse(after[1]).relationships).toEqual(JSON.parse(before[1]).relationships);
  await page.locator("#clear-session").click();
  await expect(page.locator("#admin-profile-change")).toBeEmpty();
  await unlock(page);
  await personProfile(page, "PrivateOnlyLast");
  await expect(page.locator("#person-detail-name")).toContainText("PrivateOnlyLast");
  await expect(page.locator("#person-detail")).toContainText("Fictional corrected birth 1903");
  await expect(page.locator("#person-detail")).toContainText(note);
  expect(await page.evaluate(() => window.profileInjected === true)).toBe(false);
  await page.locator("#people-close").click();
  await page.locator("#admin-review-button").click();
  await page.locator("#admin-status-filter").selectOption("accepted");
  await page.locator(".admin-suggestion-item").filter({ hasText: "Fictional profile visitor" }).click();
  await page.locator("#admin-add-to-draft").click();
  await expect(page.locator("#admin-review-status")).toContainText("Vrati prijedlog na čekanje");
  await page.locator("#admin-mark-pending").click();
  await expect(page.locator("#admin-detail-status")).toHaveText("pending");
  await page.locator('[data-accepted-profile-field="last name"]').uncheck();
  await page.locator('[data-accepted-profile-field="notes"]').uncheck();
  await page.locator("#admin-accept").click();
  await expect(page.locator("#admin-review-status")).toContainText("Odabrani podaci već su upisani");
  await page.locator("#admin-dialog-close").click();
  await expect(page.locator("#save-button")).toBeHidden();
  expect(await editionBytes()).toEqual(after);
});

test("withdrawn public profiles keep unsent corrections and refreshed catalogs allow retry without private access", async ({ page }) => {
  const before = await editionBytes();
  await unlock(page);
  await configureLocalCode(page);
  await page.locator("#admin-sign-out").click();
  const catalog = JSON.parse(before[1]);
  await page.route("**/data/family.anchors.public.json", route => route.fulfill({ contentType: "application/json",
    body: JSON.stringify({ ...catalog, catalogVersion: "sha256:" + "d".repeat(64) }) }));
  await page.reload();
  await openPublicCorrection(page);
  await page.locator('[data-profile-field="birthday"]').check();
  await page.locator('[data-proposed-field="birthday"]').fill("Fictional retained correction");
  await page.locator("#suggestion-name").fill("Fictional refreshed profile visitor");
  await page.locator("#suggestion-code").fill(SUBMISSION_CODE);
  await page.unroute("**/data/family.anchors.public.json");
  await page.route("**/data/family.anchors.public.json", route => route.fulfill({ contentType: "application/json",
    body: JSON.stringify({ ...catalog, anchors: [], relationships: [] }) }));
  let sent = 0;
  page.on("request", request => { if (new URL(request.url()).pathname === "/api/suggestions") sent++; });
  await page.locator("#suggestion-submit").click();
  await expect(page.locator("#suggestion-status")).toContainText("Osoba više nije javno prikazana");
  await expect(page.locator('[data-proposed-field="birthday"]')).toHaveValue("Fictional retained correction");
  expect(sent).toBe(0);
  await page.unroute("**/data/family.anchors.public.json");
  await page.locator("#suggestion-code").fill(SUBMISSION_CODE);
  const sending = page.waitForRequest(request => new URL(request.url()).pathname === "/api/suggestions");
  await page.locator("#suggestion-submit").click();
  const submitted = (await sending).postDataJSON();
  expect(submitted.profileChange.catalogVersion).toBe(catalog.catalogVersion);
  expect(submitted.profileChange.changes).toEqual({ birthday: "Fictional retained correction" });
  await expect(page.locator("#suggestion-status")).toContainText("poslan je na pregled");
  expect(await editionBytes()).toEqual(before);
  await page.locator("#suggestion-close").click();
  await page.locator("#people-close").click();
  const status = await (await fetch(ORIGIN + "/api/status")).json();
  await page.route("**/api/status", route => route.fulfill({ contentType: "application/json",
    body: JSON.stringify({ ...status, localProfileSuggestions: false }) }));
  await page.reload();
  await page.locator("#public-tree-button").click();
  await personProfile(page, "Reviewed Public Label");
  await expect(page.locator("#person-suggest-change")).toBeHidden();
});

test("reference selection explains ancestors and relatives through partners and clears on Lock or reload", async ({ page }) => {
  const before = await editionBytes();
  await unlock(page);
  await personProfile(page, "Child Example");
  await page.locator("#relationship-set-reference").click();
  await personProfile(page, "Grand Example");
  await expect(page.locator(".relationship-status")).toHaveText("Predak početne osobe · broj generacija: 2.");
  await expect(page.locator(".relationship-path .relationship-step")).toHaveText(["Početna osoba", "↓ roditelj", "↓ roditelj"]);
  await expect(page.locator(".relationship-path .person-link strong")).toHaveText(["Child Example", "Parent Example", "Grand Example"]);
  await personProfile(page, "Alex Example");
  await expect(page.locator(".relationship-status")).toContainText("nije pronađena veza");
  await page.locator("#relationship-set-reference").click();
  await personProfile(page, "Morgan PartnerFamily");
  await expect(page.locator(".relationship-status")).toHaveText("Put uključuje supružnika ili partnera.");
  await expect(page.locator(".relationship-path .relationship-step")).toHaveText(["Početna osoba", "↓ supružnik/partner", "↓ roditelj"]);
  await expect(page.locator(".relationship-path .person-link strong")).toHaveText(["Alex Example", "Blair Example", "Morgan PartnerFamily"]);
  await page.locator(".relationship-path .person-link").nth(1).click();
  await expect(page.locator("#person-detail-name")).toHaveText("Blair Example");
  await expect(page.locator(".relationship-status")).toHaveText("Upisana partnerska veza.");
  await personProfile(page, "NeverPublic Person");
  await expect(page.locator(".relationship-status")).toContainText("nije pronađena veza");
  await page.locator("#people-close").click();
  await page.locator("#people-button").click();
  await expect(page.locator("#relationship-reference-label")).toContainText("Alex Example");
  await page.locator("#people-close").click();
  await page.locator("#clear-session").click();
  await expect(page.locator("#relationship-reference-label")).toHaveText("Početna osoba nije odabrana.");
  await expect(page.locator(".relationship-path")).toHaveCount(0);
  await unlock(page);
  await personProfile(page, "Alex Example");
  await page.locator("#relationship-set-reference").click();
  await page.locator("#people-close").click();
  let prompts = 0;
  page.on("dialog", dialog => { prompts++; return dialog.accept(); });
  await page.reload();
  await expect(page.locator("#lock-screen")).toBeVisible();
  expect(prompts).toBe(0);
  await expect(page.locator("#relationship-reference-label")).toHaveText("Početna osoba nije odabrana.");
  expect(await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) }))).toEqual({ local: [], session: [] });
  expect(await editionBytes()).toEqual(before);
});

test("public relationship paths use only approved people, render labels as text and fit on a phone", async ({ page }) => {
  const privateRequests = [];
  page.on("request", request => { if (/family\.enc\.json|\/api\/(session|save|media)/.test(request.url())) privateRequests.push(request.url()); });
  const label = 'Approved One <img src=x onerror="window.pathInjected=true">';
  await page.route("**/data/family.anchors.public.json", async route => {
    const response = await route.fetch(), catalog = await response.json();
    await route.fulfill({ response, json: { ...catalog, anchors: [
      { id: "public-disconnected", displayLabel: "Approved Disconnected" },
      { id: "public-inlaw", displayLabel: "Approved Inlaw", lifespanLabel: "oko 1950" },
      { id: "public-one", displayLabel: label }, { id: "public-partner", displayLabel: "Approved Partner" }
    ], relationships: [
      { from: "public-inlaw", to: "public-partner", type: "parentOf" },
      { from: "public-one", to: "public-partner", type: "spouseOf" }
    ] } });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/family-preview/");
  await page.locator("#public-tree-button").click();
  await personProfile(page, "Approved One");
  await page.locator("#relationship-set-reference").click();
  await personProfile(page, "Approved Inlaw");
  await expect(page.locator(".relationship-path .person-link strong")).toHaveText([label, "Approved Partner", "Approved Inlaw"]);
  await expect(page.locator(".relationship-path")).toContainText("Javne godine: oko 1950");
  await expect(page.locator(".relationship-path img")).toHaveCount(0);
  expect(await page.evaluate(() => window.pathInjected === true)).toBe(false);
  const layout = await page.locator("#people-dialog").evaluate(dialog => ({
    fits: dialog.getBoundingClientRect().left >= 0 && dialog.getBoundingClientRect().right <= innerWidth,
    overflow: dialog.scrollWidth > dialog.clientWidth + 1,
    touchHeight: dialog.querySelector("#relationship-set-reference").getBoundingClientRect().height
  }));
  expect(layout.fits).toBe(true);
  expect(layout.overflow).toBe(false);
  expect(layout.touchHeight).toBeGreaterThanOrEqual(43.5);
  await personProfile(page, "Approved Disconnected");
  await expect(page.locator(".relationship-status")).toHaveText("U javno prikazanim podacima nije pronađena veza s početnom osobom.");
  await expect(page.locator("#person-detail")).not.toContainText("PrivateOnly");
  await page.locator("#people-back").click();
  await page.locator("#relationship-clear-reference").click();
  await expect(page.locator("#relationship-reference-label")).toHaveText("Početna osoba nije odabrana.");
  await expect(page.locator(".relationship-path")).toHaveCount(0);
  expect(privateRequests).toEqual([]);
});

test("choosing or clearing a reference preserves unfinished profile fields and cancelled navigation", async ({ page }) => {
  const before = await editionBytes();
  await unlock(page);
  await personProfile(page, "Alex Example");
  await page.locator(".person-edit summary").click();
  const notes = page.locator('.person-profile-form textarea[name="notes"]');
  await notes.fill("Fictional unfinished profile note");
  await page.locator("#relationship-set-reference").click();
  await expect(notes).toHaveValue("Fictional unfinished profile note");
  await page.locator("#relationship-clear-reference").click();
  await expect(notes).toHaveValue("Fictional unfinished profile note");
  await page.locator("#relationship-set-reference").click();
  await page.locator("#people-search").fill("Morgan PartnerFamily");
  page.once("dialog", dialog => dialog.dismiss());
  await page.locator("#people-results .person-link").click();
  await expect(page.locator("#person-detail-name")).toHaveText("Alex Example");
  await expect(notes).toHaveValue("Fictional unfinished profile note");
  page.once("dialog", dialog => dialog.accept());
  await page.locator("#people-results .person-link").click();
  await expect(page.locator("#person-detail-name")).toHaveText("Morgan PartnerFamily");
  await expect(page.locator(".relationship-status")).toHaveText("Put uključuje supružnika ili partnera.");
  expect(await editionBytes()).toEqual(before);
});

test("guest photo selection survives failed sending; private review and explicit assignment save its original safely", async ({ page }) => {
  const before = await editionBytes();
  await page.setViewportSize({ width: 390, height: 844 });
  await unlock(page);
  const [photo] = await fictionalPhotos(page, ["#f39b19"]);
  await personProfile(page, "NeverPublic Person");
  const originalGalleryCount = await page.locator(".person-gallery .photo-tile").count();
  const originalPortraitCount = await page.locator(".person-portrait").count();
  await page.locator("#people-close").click();
  await configureLocalCode(page);
  await page.locator("#admin-sign-out").click();
  await page.locator("#guest-suggest-button").click();
  const fileInput = page.locator('#text-photo-attachments input[type="file"]');
  await fileInput.setInputFiles({ name: "fictional.svg", mimeType: "image/svg+xml", buffer: Buffer.from('<svg onload="window.badPhoto=true"/>') });
  await expect(page.locator("#text-photo-attachments .suggestion-photo-status")).toContainText("JPEG, PNG ili WebP");
  await expect(page.locator("#text-photo-attachments .suggestion-photo-item")).toHaveCount(0);
  await fileInput.setInputFiles(photo);
  await expect(page.locator("#text-photo-attachments .suggestion-photo-item")).toHaveCount(1);
  const caption = 'Fictional guest caption <img src=x onerror="window.badPhoto=true">';
  await page.locator("#text-photo-attachments .suggestion-photo-item input").fill(caption);
  await page.locator("#suggestion-name").fill("Fictional photo browser visitor");
  await page.locator("#suggestion-message").fill("Fictional image evidence");
  page.once("dialog", dialog => dialog.dismiss());
  await page.keyboard.press("Escape");
  await expect(page.locator("#suggestion-dialog")).toBeVisible();
  await expect(page.locator("#text-photo-attachments .suggestion-photo-item")).toHaveCount(1);
  let uploads = 0;
  page.on("request", request => {
    if (request.url().endsWith("/api/suggestions/photos")) {
      uploads++;
      expect(request.postDataJSON().password).toBeUndefined();
    }
  });
  await page.locator("#suggestion-code").fill("wrong-code");
  await page.locator("#suggestion-submit").click();
  await expect(page.locator("#suggestion-status")).toContainText("code is invalid");
  await expect(page.locator("#text-photo-attachments .suggestion-photo-item input")).toHaveValue(caption);
  await page.route("**/api/suggestions", route => route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"Submission failed"}' }));
  await page.locator("#suggestion-code").fill(SUBMISSION_CODE);
  await page.locator("#suggestion-submit").click();
  await expect(page.locator("#suggestion-status")).toContainText("Unable to send");
  await expect(page.locator("#suggestion-message")).toHaveValue("Fictional image evidence");
  await expect(page.locator("#text-photo-attachments .suggestion-photo-item")).toHaveCount(1);
  await page.unroute("**/api/suggestions");
  await page.locator("#suggestion-code").fill(SUBMISSION_CODE);
  await page.locator("#suggestion-submit").click();
  await expect(page.locator("#suggestion-status")).toContainText("sent for review");
  expect(uploads).toBe(2);
  await expect(page.locator("#text-photo-attachments .suggestion-photo-item")).toHaveCount(0);
  await page.locator("#suggestion-close").click();
  await unlock(page);
  await page.locator("#admin-review-button").click();
  await page.locator(".admin-suggestion-item").filter({ hasText: "Fictional photo browser visitor" }).click();
  await expect(page.locator("#admin-photo-list .admin-photo-item")).toHaveCount(1);
  await expect(page.locator("#admin-photo-list select")).toBeDisabled();
  await expect.poll(() => page.locator("#admin-photo-list img").evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
  expect(await page.evaluate(() => window.badPhoto === true)).toBe(false);
  await page.locator("#admin-photo-list .photo-tile").click();
  const downloading = page.waitForEvent("download");
  await page.getByRole("link", { name: "Preuzmi izvornu fotografiju" }).click();
  expect(await readFile(await (await downloading).path())).toEqual(photo.buffer);
  await page.getByRole("button", { name: "Zatvori fotografiju", exact: true }).click();
  await page.locator("#admin-accept").click();
  await expect(page.locator("#admin-detail-status")).toHaveText("accepted");
  await page.locator("#admin-photo-list select").selectOption("private-person");
  await page.locator("#admin-photos-to-draft").click();
  await expect(page.locator("#admin-review-status")).toContainText("Fotografije su u privatnom nacrtu");
  await page.locator("#admin-photo-list select").selectOption("private-person");
  await page.locator("#admin-photos-to-draft").click();
  await expect(page.locator("#admin-review-status")).toContainText("već su u tim galerijama");
  expect(await editionBytes()).toEqual(before);
  await page.locator("#admin-dialog-close").click();
  await personProfile(page, "NeverPublic Person");
  await expect(page.locator(".person-gallery .photo-tile")).toHaveCount(originalGalleryCount + 1);
  await expect(page.locator(".person-gallery")).toContainText(caption);
  await expect(page.locator(".person-portrait")).toHaveCount(originalPortraitCount);
  await page.locator("#people-close").click();
  await page.locator("#save-button").click();
  await expect(page.locator("#tree-status")).toContainText("Saved and verified");
  await page.locator("#clear-session").click();
  await expect(page.locator("#admin-photo-list")).toBeEmpty();
  await page.locator("#public-tree-button").click();
  await expect(page.locator(".photo-tile")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("Fictional guest caption");
});

test("submitting while a selected photo is still being checked cannot silently omit it", async ({ page }) => {
  const before = await editionBytes();
  await unlock(page);
  const [photo] = await fictionalPhotos(page);
  await configureLocalCode(page);
  await page.locator("#admin-sign-out").click();
  await page.locator("#guest-suggest-button").click();
  await page.locator("#suggestion-name").fill("Fictional waiting visitor");
  await page.locator("#suggestion-message").fill("Fictional waiting for a photo");
  await page.locator("#suggestion-code").fill(SUBMISSION_CODE);
  await page.evaluate(() => {
    const original = HTMLImageElement.prototype.decode;
    let release;
    const held = new Promise(resolve => { release = resolve; });
    HTMLImageElement.prototype.decode = async function() { await held; return original.call(this); };
    window.releasePhotoCheck = () => { HTMLImageElement.prototype.decode = original; release(); };
  });
  let submissions = 0;
  page.on("request", request => { if (/\/api\/suggestions(?:\/photos)?$/.test(request.url())) submissions++; });
  const input = page.locator('#text-photo-attachments input[type="file"]');
  await input.setInputFiles(photo);
  await expect(page.locator("#text-photo-attachments .suggestion-photo-status")).toContainText("Provjeravam");
  await page.locator("#suggestion-submit").click();
  await expect(page.locator("#suggestion-status")).toContainText("Pričekaj završetak provjere");
  expect(submissions).toBe(0);
  await page.evaluate(() => window.releasePhotoCheck());
  await expect(page.locator("#text-photo-attachments .suggestion-photo-item")).toHaveCount(1);
  await input.setInputFiles({ ...photo, name: "fictional duplicate.png" });
  await expect(page.locator("#text-photo-attachments .suggestion-photo-status")).toContainText("čekaju slanje");
  await expect(page.locator("#text-photo-attachments .suggestion-photo-item")).toHaveCount(1);
  await input.setInputFiles(Array(7).fill(photo));
  await expect(page.locator("#text-photo-attachments .suggestion-photo-status")).toContainText("najviše šest");
  await expect(page.locator("#text-photo-attachments .suggestion-photo-item")).toHaveCount(1);
  await page.getByRole("button", { name: "Ukloni fotografiju", exact: true }).click();
  await page.locator("#suggestion-close").click();
  expect(submissions).toBe(0);
  expect(await editionBytes()).toEqual(before);
});

test("a late photo assignment response cannot restore a gallery draft after Lock", async ({ page, context }) => {
  const before = await editionBytes();
  await unlock(page);
  const [photo] = await fictionalPhotos(page, ["#b51674"]);
  await personProfile(page, "NeverPublic Person");
  const originalCount = await page.locator(".person-gallery .photo-tile").count();
  await page.locator("#people-close").click();
  await configureLocalCode(page);
  const upload = await context.request.post(ORIGIN + "/api/suggestions/photos", { headers: { Origin: ORIGIN }, data: {
    accessCode: SUBMISSION_CODE, name: photo.name, type: photo.mimeType, content: photo.buffer.toString("base64") } });
  expect(upload.status()).toBe(201);
  const token = (await upload.json()).token;
  const submitted = await context.request.post(ORIGIN + "/api/suggestions", { headers: { Origin: ORIGIN }, data: {
    schemaVersion: 1, type: "text", accessCode: SUBMISSION_CODE, submitterName: "Fictional late photo visitor", message: "Fictional late image",
    photoTokens: [{ token, caption: "Fictional late photograph" }] } });
  expect(submitted.status()).toBe(201);
  await page.locator("#admin-refresh").click();
  await page.locator(".admin-suggestion-item").filter({ hasText: "Fictional late photo visitor" }).click();
  await page.locator("#admin-accept").click();
  await expect(page.locator("#admin-detail-status")).toHaveText("accepted");
  await page.locator("#admin-photo-list select").selectOption("private-person");
  let release, ready;
  const held = new Promise(resolve => { release = resolve; });
  const committed = new Promise(resolve => { ready = resolve; });
  await page.route("**/api/admin/suggestions/photo-draft", async route => {
    const response = await route.fetch(); ready(); await held; await route.fulfill({ response });
  });
  await page.locator("#admin-photos-to-draft").click();
  await committed;
  await page.locator("#admin-sign-out").click();
  await expect(page.locator("#lock-screen")).toBeVisible();
  const delivered = page.waitForResponse(response => response.url().endsWith("/api/admin/suggestions/photo-draft"));
  release(); await delivered;
  await page.unroute("**/api/admin/suggestions/photo-draft");
  await expect(page.locator("#admin-photo-list")).toBeEmpty();
  await expect(page.locator(".photo-dialog, .personal-tree-card")).toHaveCount(0);
  await unlock(page);
  await personProfile(page, "NeverPublic Person");
  await expect(page.locator(".person-gallery .photo-tile")).toHaveCount(originalCount);
  await page.locator("#people-close").click();
  await page.locator("#admin-review-button").click();
  await page.locator("#admin-status-filter").selectOption("accepted");
  await page.locator(".admin-suggestion-item").filter({ hasText: "Fictional late photo visitor" }).click();
  await page.locator("#admin-photo-list select").selectOption("private-person");
  await page.locator("#admin-photos-to-draft").click();
  await expect(page.locator("#admin-review-status")).toContainText("Fotografije su u privatnom nacrtu");
  await page.locator("#admin-dialog-close").click();
  page.once("dialog", dialog => dialog.accept());
  await page.locator("#discard-button").click();
  expect(await editionBytes()).toEqual(before);
});
