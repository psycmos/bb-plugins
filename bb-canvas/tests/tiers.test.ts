import { describe, expect, it } from "vitest";
import { sizeOf, TIER_OF, TIER_SIZE, TIER_TYPOGRAPHY } from "@/lib/tiers";
import type { CanvasNodeKind } from "@/lib/types";

const ALL_KINDS: CanvasNodeKind[] = [
  "agents",
  "project",
  "crew",
  "graph-run",
  "thread",
  "member",
  "step",
  "turn",
  "tool-call",
  "subagent",
  "system-event",
];

describe("tiers", () => {
  it("assigns every node kind to exactly one of the three tiers", () => {
    for (const kind of ALL_KINDS) {
      expect(["group", "card", "row"]).toContain(TIER_OF[kind]);
    }
  });

  it("draws every kind as a two-line card, as agent-graph (BBP-298)", () => {
    for (const kind of ALL_KINDS) expect(TIER_OF[kind]).toBe("card");
  });

  it("gives a group a 28px header height, a card 220x52, a row 200x26", () => {
    expect(TIER_SIZE.group.height).toBe(28);
    expect(TIER_SIZE.card).toEqual({ width: 220, height: 52 });
    expect(TIER_SIZE.row).toEqual({ width: 200, height: 26 });
  });

  it("sizeOf looks a kind's size up through its tier", () => {
    expect(sizeOf("crew")).toEqual(TIER_SIZE.card);
    expect(sizeOf("member")).toEqual(TIER_SIZE.card);
    expect(sizeOf("step")).toEqual(TIER_SIZE.card);
  });

  it("defines a typography scale for all three tiers", () => {
    for (const tier of ["group", "card", "row"] as const) {
      expect(TIER_TYPOGRAPHY[tier].titleSize).toBeGreaterThan(0);
    }
  });
});
