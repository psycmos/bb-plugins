import { describe, expect, it } from "vitest";
import { clampWidth, DEFAULT_WIDTH, fitWidth, MAX_WIDTH, maxWidthFor, MIN_WIDTH, NARROW_FLOOR } from "@/lib/clampWidth";

describe("clampWidth", () => {
  it("keeps an in-range width as is", () => {
    expect(clampWidth(400)).toBe(400);
    expect(clampWidth(MIN_WIDTH)).toBe(300);
    expect(clampWidth(MAX_WIDTH)).toBe(640);
  });

  it("caps a width below the minimum at the minimum", () => {
    expect(clampWidth(299)).toBe(300);
    expect(clampWidth(-1000)).toBe(300);
  });

  it("caps a width above the maximum at the maximum", () => {
    expect(clampWidth(641)).toBe(640);
    expect(clampWidth(99999)).toBe(640);
  });

  it("falls back to the default for a non-finite value", () => {
    expect(DEFAULT_WIDTH).toBe(360);
    expect(clampWidth(Number.NaN)).toBe(360);
    expect(clampWidth(Number.POSITIVE_INFINITY)).toBe(360);
  });
});

describe("fitWidth (narrow panel, BBP-179 acceptance)", () => {
  it("leaves the width alone when the container is unmeasured", () => {
    expect(fitWidth(640, 0)).toBe(640);
    expect(maxWidthFor(0)).toBe(MAX_WIDTH);
  });

  it("leaves the width alone in a wide container", () => {
    expect(fitWidth(640, 1600)).toBe(640);
    expect(maxWidthFor(1600)).toBe(640);
    // A 1280px window's row: the full clamp still applies.
    expect(maxWidthFor(1200)).toBe(640);
  });

  it("caps the width at half of a narrow container", () => {
    expect(maxWidthFor(700)).toBe(350);
    expect(fitWidth(640, 700)).toBe(350);
    expect(fitWidth(320, 700)).toBe(320);
  });

  it("grows smoothly between narrow and wide, leaving the canvas its reserve", () => {
    expect(maxWidthFor(1000)).toBe(500);
    expect(maxWidthFor(1150)).toBe(590);
  });

  it("never goes below the narrow floor, even below the 300px clamp", () => {
    expect(maxWidthFor(370)).toBe(185);
    expect(fitWidth(320, 370)).toBe(185);
    expect(maxWidthFor(200)).toBe(NARROW_FLOOR);
    expect(NARROW_FLOOR).toBe(160);
  });
});
