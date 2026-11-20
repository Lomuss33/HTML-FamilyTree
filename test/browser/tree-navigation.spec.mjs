import { test, expect } from '@playwright/test';

async function openTree(page) {
  page.on('pageerror', error => { throw error; });
  await page.goto('/');
  await expect(page.locator('#public-tree-button')).toBeEnabled();
  await page.locator('#public-tree-button').click();
  await expect(page.locator('#tree-shell')).toBeVisible();
}
const transform = page => page.locator('#f3Canvas').evaluate(el => ({ x: el.__zoom.x, y: el.__zoom.y, k: el.__zoom.k }));

test('view controls zoom, fit and preserve drag navigation', async ({ page }) => {
  await openTree(page);
  await page.waitForTimeout(500);
  const initial = await transform(page);
  await page.locator('#tree-zoom-in').click();
  await expect.poll(async () => (await transform(page)).k).toBeGreaterThan(initial.k);
  await page.waitForTimeout(250);
  const enlarged = await transform(page);
  await page.locator('#tree-zoom-out').click();
  await expect.poll(async () => (await transform(page)).k).toBeLessThan(enlarged.k);
  const box = await page.locator('#family-chart').boundingBox();
  const beforeDrag = await transform(page);
  await page.mouse.move(box.x + 35, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 145, box.y + 150, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => (await transform(page)).x).not.toBe(beforeDrag.x);
  await expect(page.locator('#people-dialog')).not.toBeVisible();
  await page.locator('#tree-fit').click();
  await page.waitForTimeout(300);
  await expect(page.locator('#tree-zoom-level')).toHaveText(Math.round((await transform(page)).k * 100) + '%');
});

test('touch layout keeps view controls inside the viewport and supports dragging', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await openTree(page);
  await page.waitForTimeout(500);
  const controls = await page.locator('.tree-view-controls').boundingBox();
  expect(controls.x).toBeGreaterThanOrEqual(0);
  expect(controls.x + controls.width).toBeLessThanOrEqual(390);
  await page.locator('#tree-zoom-in').tap();
  const before = await transform(page);
  const box = await page.locator('#family-chart').boundingBox();
  const session = await context.newCDPSession(page);
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + 30, y: box.y + 120 }] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: box.x + 110, y: box.y + 160 }] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(async () => (await transform(page)).x).not.toBe(before.x);
  await expect(page.locator('#people-dialog')).not.toBeVisible();
  await page.waitForTimeout(250);
  const beforePinch = await transform(page);
  const y = box.y + 220;
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 140, y, id: 0 }, { x: 240, y, id: 1 }] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 100, y, id: 0 }, { x: 280, y, id: 1 }] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(async () => (await transform(page)).k).toBeGreaterThan(beforePinch.k);
  await context.close();
});
