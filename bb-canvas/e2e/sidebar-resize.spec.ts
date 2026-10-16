// BBP-182/186: the sidebar's resize separator in a real browser — real
// pointer drag and real key presses, each gated on the rendered width.
import { test, expect, type Page } from "@playwright/test";

const sidebar = (page: Page) => page.getByLabel("Details for orch-lead");
const handle = (page: Page) => page.getByRole("separator", { name: "Resize panel" });
const renderedWidth = async (page: Page) => (await sidebar(page).boundingBox())!.width;

async function openSidebar(page: Page) {
  await page.getByRole("button", { name: new RegExp("^orch-lead — ") }).click();
  await expect(sidebar(page)).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/index.html");
  await page.evaluate(() => localStorage.removeItem("bb-canvas:sidebar-width"));
  await page.reload();
  await page.getByRole("button", { name: new RegExp("^factory-1 — ") }).waitFor();
  await openSidebar(page);
});

test("starts at the default width of 360px", async ({ page }) => {
  await expect(handle(page)).toHaveAttribute("aria-valuenow", "360");
  expect(await renderedWidth(page)).toBe(360);
});

test("Left/Right move 16px, Home/End jump to the bounds and stay there", async ({ page }) => {
  await handle(page).focus();
  await page.keyboard.press("ArrowLeft");
  await expect(handle(page)).toHaveAttribute("aria-valuenow", "376");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(handle(page)).toHaveAttribute("aria-valuenow", "344");

  await page.keyboard.press("End");
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowLeft");
  await expect(handle(page)).toHaveAttribute("aria-valuenow", "640");
  expect(await renderedWidth(page)).toBe(640);

  await page.keyboard.press("Home");
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowRight");
  await expect(handle(page)).toHaveAttribute("aria-valuenow", "300");
  expect(await renderedWidth(page)).toBe(300);
});

test("dragging resizes live and clamps past either edge", async ({ page }) => {
  const box = (await handle(page).boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 50, y, { steps: 5 });
  await expect(handle(page)).toHaveAttribute("aria-valuenow", "410");
  await page.mouse.move(x - 2000, y, { steps: 5 });
  await expect(handle(page)).toHaveAttribute("aria-valuenow", "640");
  await page.mouse.move(x + 2000, y, { steps: 5 });
  await expect(handle(page)).toHaveAttribute("aria-valuenow", "300");
  await page.mouse.up();
  expect(await renderedWidth(page)).toBe(300);
});

test("the chosen width survives a reload", async ({ page }) => {
  await handle(page).focus();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await expect(handle(page)).toHaveAttribute("aria-valuenow", "392");
  await page.reload();
  await page.getByRole("button", { name: new RegExp("^factory-1 — ") }).waitFor();
  await openSidebar(page);
  await expect(handle(page)).toHaveAttribute("aria-valuenow", "392");
  expect(await renderedWidth(page)).toBe(392);
});

test.describe("in a narrow panel (BBP-179 acceptance)", () => {
  test.use({ viewport: { width: 600, height: 700 } });

  test("the sidebar takes at most half the canvas, and gets its width back when the panel widens", async ({ page }) => {
    const row = await sidebar(page).evaluate((element) => element.parentElement!.clientWidth);
    const half = Math.floor(row / 2);
    await handle(page).focus();
    await page.keyboard.press("End");
    await expect(handle(page)).toHaveAttribute("aria-valuemax", String(half));
    await expect(handle(page)).toHaveAttribute("aria-valuenow", String(half));
    expect(await renderedWidth(page)).toBe(half);

    // A drag past the edge stays capped as well.
    const box = (await handle(page).boundingBox())!;
    await page.mouse.move(box.x + 4, box.y + 20);
    await page.mouse.down();
    await page.mouse.move(box.x - 2000, box.y + 20, { steps: 5 });
    await page.mouse.up();
    expect(await renderedWidth(page)).toBe(half);

    // The user's choice is kept, only capped: a wide panel shows it again.
    await page.setViewportSize({ width: 1600, height: 700 });
    await expect(handle(page)).toHaveAttribute("aria-valuenow", "640");
  });
});
