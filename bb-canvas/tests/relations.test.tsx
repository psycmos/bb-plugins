// @vitest-environment jsdom
// BBP-202: relation edges (a crew's declared links) — hidden unless the
// "Relations" toggle is on or a member is selected, labels only on hover or
// selection, and always below the cards.
import { describe, expect, it } from "vitest";
import { relationsView } from "@/lib/relations";
import { relationLabelVisible } from "@/components/StatusEdge";
import { toFlowEdges } from "@/components/CanvasShell";
import { layoutTree } from "@/lib/layout";
import type { CanvasEdge, CanvasNode } from "@/lib/types";


const ab: CanvasEdge = { from: "a", to: "b", variant: "flow", label: "assigns_to", relation: true };
const bc: CanvasEdge = { from: "b", to: "c", variant: "flow", label: "works_with", relation: true };
const message: CanvasEdge = { from: "c", to: "a", variant: "message", label: "2" };
const all = [ab, bc, message];

describe("relationsView", () => {
  it("negative: toggle off and nothing selected shows no relation edge, other edges unchanged", () => {
    expect(relationsView(all, false, null)).toEqual([message]);
  });

  it("toggle on and nothing selected shows every relation edge with equal weight", () => {
    expect(relationsView(all, true, null)).toEqual(all);
  });

  it("a selected member shows only its own relation edges, highlighted, even with the toggle off", () => {
    expect(relationsView(all, false, "c")).toEqual([{ ...bc, emphasis: "highlight" }, message]);
  });

  it("with the toggle on, a selection dims the relation edges that are not its own", () => {
    expect(relationsView(all, true, "c")).toEqual([{ ...ab, emphasis: "dim" }, { ...bc, emphasis: "highlight" }, message]);
  });

  it("a selection without relation edges falls back to the toggle", () => {
    expect(relationsView(all, false, "x")).toEqual([message]);
    expect(relationsView(all, true, "x")).toEqual(all);
  });
});

describe("relation labels", () => {
  const data = { variant: "flow" as const, path: "M 0 0 L 1 1", label: "assigns_to", relation: true };
  it("negative: a relation label is not shown permanently", () => {
    expect(relationLabelVisible(data, false)).toBe(false);
    expect(relationLabelVisible({ ...data, emphasis: "dim" }, false)).toBe(false);
  });
  it("shows on hover or when highlighted by a selection", () => {
    expect(relationLabelVisible(data, true)).toBe(true);
    expect(relationLabelVisible({ ...data, emphasis: "highlight" }, false)).toBe(true);
  });
  it("other edges keep their label as before", () => {
    expect(relationLabelVisible({ ...data, relation: undefined }, false)).toBe(true);
  });
});

const nodes: CanvasNode[] = [
  { id: "crew", kind: "crew", label: "trio", parentId: null },
  { id: "a", kind: "member", label: "lead", parentId: "crew" },
  { id: "b", kind: "member", label: "dev", parentId: "crew" },
];

describe("relation edges in the shell", () => {
  it("render below the cards and badges: z-index 0, under React Flow's node layer", () => {
    const layout = layoutTree(nodes, new Set(["crew"]), [ab]);
    const flow = toFlowEdges(layout.edges);
    const relation = flow.find((edge) => (edge.data as { relation?: boolean }).relation);
    expect(relation?.zIndex).toBe(0);
    expect(flow.filter((edge) => edge !== relation).every((edge) => edge.zIndex === undefined)).toBe(true);
  });

  it("carry relation and emphasis through the layout", () => {
    const layout = layoutTree(nodes, new Set(["crew"]), [{ ...ab, emphasis: "highlight" }]);
    expect(layout.edges.find((edge) => edge.relation)).toMatchObject({ relation: true, emphasis: "highlight", label: "assigns_to" });
  });
});

describe("relations on by default where a page asks for it (BBP-191)", () => {
  it("falls back to the page's default until the user chose, then keeps the choice", async () => {
    const { loadRelations, saveRelations } = await import("@/lib/relations");
    localStorage.clear();
    expect(loadRelations("canvas", true)).toBe(true);
    saveRelations("canvas", false);
    expect(loadRelations("canvas", true)).toBe(false);
    expect(loadRelations("other")).toBe(false);
  });
});
