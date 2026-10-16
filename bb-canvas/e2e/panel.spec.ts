// BBP-313/309: the always-open side panel and the breadcrumb island in a real
// browser — the layout jsdom cannot measure.
import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/index.html?panel=1");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole("button", { name: new RegExp("^factory-1 — ") }).waitFor();
});

test("the overview fills the panel's height beside the canvas, with no toolbar above", async ({ page }) => {
  const overview = page.getByRole("complementary", { name: "Overview" });
  await expect(overview).toBeVisible();
  const box = (await overview.boundingBox())!;
  expect(box.width).toBe(360);
  expect(box.y).toBeLessThan(2);
  await expect(page.getByRole("button", { name: "Collapse all" })).toHaveCount(0);
  await page.screenshot({ path: "test-results/panel-overview.png" });
});

test("a card turns the panel into its view", async ({ page }) => {
  await page.getByRole("button", { name: new RegExp("^orch-lead — ") }).click();
  const details = page.getByRole("complementary", { name: "Details for orch-lead" });
  await expect(details).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Message" })).toBeVisible();
  await page.screenshot({ path: "test-results/panel-node.png" });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("complementary", { name: "Overview" })).toBeVisible();
});

test("] folds the panel away and the capsule brings it back", async ({ page }) => {
  await page.locator("[data-canvas-view]").focus();
  await page.keyboard.press("]");
  await expect(page.getByRole("complementary")).toHaveCount(0);
  await page.screenshot({ path: "test-results/panel-folded.png" });
  await page.getByRole("button", { name: "Show panel (])" }).click();
  await expect(page.getByRole("complementary", { name: "Overview" })).toBeVisible();
});

test("/ focuses the panel's search, even when the panel was folded", async ({ page }) => {
  await page.locator("[data-canvas-view]").focus();
  await page.keyboard.press("]");
  await page.keyboard.press("/");
  await expect(page.getByRole("textbox", { name: "Search nodes" })).toBeFocused();
});
