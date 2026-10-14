import { describe, expect, it } from "vitest";
import { layoutTree, MARGIN, NODE_HEIGHT, NODE_WIDTH, COLUMN_GAP, ROW_GAP } from "@/lib/layout";
import type { CanvasEdge, CanvasFrame, CanvasNode } from "@/lib/types";

function node(id: string, parentId: string | null, overrides: Partial<CanvasNode> = {}): CanvasNode {
  return { id, kind: "member", label: id, parentId, ...overrides };
}

describe("layoutTree", () => {
  it("lays a tree out left to right, one column per depth", () => {
    const nodes = [
      node("agents", null, { kind: "agents" }),
      node("project", "agents", { kind: "project" }),
      node("crew", "project", { kind: "crew" }),
      node("m1", "crew", { kind: "member" }),
    ];
    const expanded = new Set(["agents", "project", "crew"]);
    const { positions } = layoutTree(nodes, expanded);

    const byId = new Map(positions.map((placed) => [placed.id, placed]));
    expect(byId.get("agents")!.column).toBe(0);
    expect(byId.get("project")!.column).toBe(1);
    expect(byId.get("crew")!.column).toBe(2);
    expect(byId.get("m1")!.column).toBe(3);
    // Columns step right by one node width plus the column gap.
    expect(byId.get("project")!.x).toBe(byId.get("agents")!.x + NODE_WIDTH + COLUMN_GAP);
    expect(byId.get("agents")!.x).toBe(MARGIN);
  });

  it("stacks siblings in the same column, one row apart", () => {
    const nodes = [
      node("crew", null, { kind: "crew" }),
      node("m1", "crew"),
      node("m2", "crew"),
      node("m3", "crew"),
    ];
    const { positions } = layoutTree(nodes, new Set(["crew"]));
    const byId = new Map(positions.map((placed) => [placed.id, placed]));
    expect(byId.get("m1")!.column).toBe(byId.get("m2")!.column);
    expect(byId.get("m2")!.column).toBe(byId.get("m3")!.column);
    expect(byId.get("m2")!.y).toBe(byId.get("m1")!.y + NODE_HEIGHT + ROW_GAP);
    expect(byId.get("m3")!.y).toBe(byId.get("m2")!.y + NODE_HEIGHT + ROW_GAP);
  });

  it("stacks siblings of different tiers in one column without overlap (BBP-221)", () => {
    const nodes = [
      node("crew", null, { kind: "crew" }),
      node("m1", "crew", { kind: "member" }), // card: 220x52
      node("s1", "crew", { kind: "step" }), // row: 200x26
      node("m2", "crew", { kind: "member" }),
    ];
    const { positions } = layoutTree(nodes, new Set(["crew"]));
    const byId = new Map(positions.map((placed) => [placed.id, placed]));
    const siblings = ["m1", "s1", "m2"].map((id) => byId.get(id)!);
    const sorted = [...siblings].sort((a, b) => a.y - b.y);
    for (let i = 0; i + 1 < sorted.length; i++) {
      expect(sorted[i]!.y + sorted[i]!.height).toBeLessThanOrEqual(sorted[i + 1]!.y);
    }
  });

  it("centres a parent on its open children and keeps subtrees apart", () => {
    const nodes = [
      node("project", null, { kind: "project" }),
      node("crewA", "project", { kind: "crew" }),
      node("a1", "crewA"),
      node("a2", "crewA"),
      node("a3", "crewA"),
      node("crewB", "project", { kind: "crew" }),
      node("b1", "crewB"),
    ];
    const { positions } = layoutTree(nodes, new Set(["project", "crewA", "crewB"]));
    const byId = new Map(positions.map((placed) => [placed.id, placed]));
    // "crew" is a group-tier header (28px) while its members are card-tier
    // (52px): centring aligns on the vertical centre of the span, not the
    // top edge, since the two tiers no longer share one height.
    const centerOf = (id: string) => byId.get(id)!.y + byId.get(id)!.height / 2;
    expect(centerOf("crewA")).toBe(centerOf("a2"));
    expect(centerOf("crewB")).toBe(centerOf("b1"));
    expect(byId.get("b1")!.y).toBe(byId.get("a3")!.y + NODE_HEIGHT + ROW_GAP);
    expect(centerOf("project")).toBe((centerOf("crewA") + centerOf("crewB")) / 2);
  });

  it("hides the children of a node that is not expanded", () => {
    const nodes = [node("crew", null, { kind: "crew" }), node("m1", "crew")];
    const { positions } = layoutTree(nodes, new Set());
    expect(positions.map((placed) => placed.id)).toEqual(["crew"]);
  });

  it("idempotent: expanding an already-expanded node does not duplicate it", () => {
    const nodes = [node("crew", null, { kind: "crew" }), node("m1", "crew")];
    const once = layoutTree(nodes, new Set(["crew"]));
    const again = layoutTree(nodes, new Set(["crew"]));
    expect(again.positions).toEqual(once.positions);
  });

  it("roots a node whose declared parent is missing, instead of throwing", () => {
    const nodes = [node("orphan", "ghost")];
    expect(() => layoutTree(nodes, new Set())).not.toThrow();
    const { positions } = layoutTree(nodes, new Set());
    expect(positions).toHaveLength(1);
    expect(positions[0]!.column).toBe(0);
  });

  it("draws a flow edge from every visible node to its parent", () => {
    const nodes = [node("crew", null, { kind: "crew" }), node("m1", "crew")];
    const { edges } = layoutTree(nodes, new Set(["crew"]));
    const flow = edges.find((edge) => edge.from === "crew" && edge.to === "m1");
    expect(flow).toBeDefined();
    expect(flow!.variant).toBe("flow");
    expect(flow!.isBack).toBe(false);
  });

  it("routes a back edge as an arc to the right of its column, with a label", () => {
    const nodes = [
      node("run", null, { kind: "graph-run" }),
      node("a", "run", { kind: "step" }),
      node("b", "run", { kind: "step" }),
      node("c", "run", { kind: "step" }),
    ];
    const backEdges: CanvasEdge[] = [{ from: "c", to: "a", variant: "back", label: "retry" }];
    const { edges } = layoutTree(nodes, new Set(["run"]), backEdges);
    const back = edges.find((edge) => edge.from === "c" && edge.to === "a");
    expect(back).toBeDefined();
    expect(back!.variant).toBe("back");
    expect(back!.isBack).toBe(true);
    expect(back!.label).toBe("retry");
    // Bows out to the right of the node, not straight down through it.
    expect(back!.path).toContain("C");
  });

  it("drops a declared edge whose endpoint is collapsed out of view", () => {
    const nodes = [
      node("run", null, { kind: "graph-run" }),
      node("a", "run", { kind: "step" }),
      node("b", "run", { kind: "step" }),
    ];
    const edges: CanvasEdge[] = [{ from: "b", to: "a", variant: "back" }];
    // "run" itself is not expanded, so neither step is visible.
    const { edges: placed } = layoutTree(nodes, new Set(), edges);
    expect(placed).toHaveLength(0);
  });

  describe("edge state (BBP-146)", () => {
    it("leaves a tree line without a state when its child was never attempted", () => {
      const nodes = [node("run", null, { kind: "graph-run" }), node("a", "run", { kind: "step" })];
      const { edges } = layoutTree(nodes, new Set(["run"]));
      expect(edges[0]!.state).toBeUndefined();
    });

    it("leaves a tree line to a done child neutral — 'taken' is gone (BBP-214 stage 1)", () => {
      const nodes = [
        node("run", null, { kind: "graph-run" }),
        node("a", "run", { kind: "step", status: "done" }),
      ];
      const { edges } = layoutTree(nodes, new Set(["run"]));
      expect(edges[0]!.state).toBeUndefined();
    });

    it("negative: a failed child's tree line is neutral too, only 'running' lights the line", () => {
      const nodes = [
        node("run", null, { kind: "graph-run" }),
        node("a", "run", { kind: "step", status: "failed" }),
      ];
      const { edges } = layoutTree(nodes, new Set(["run"]));
      expect(edges[0]!.state).toBeUndefined();
    });

    it("marks a tree line 'now' while its child is running", () => {
      const nodes = [
        node("run", null, { kind: "graph-run" }),
        node("a", "run", { kind: "step", status: "running" }),
      ];
      const { edges } = layoutTree(nodes, new Set(["run"]));
      expect(edges[0]!.state).toBe("now");
    });

    it("leaves the line to an idle node plain — idle members are not a path the run took", () => {
      const nodes = [node("crew", null, { kind: "crew" }), node("m1", "crew", { status: "idle" })];
      const { edges } = layoutTree(nodes, new Set(["crew"]));
      expect(edges[0]!.state).toBeUndefined();
    });

    it("does not count a skipped step as taken (lead decision: skipped is where routing did not go)", () => {
      const nodes = [
        node("run", null, { kind: "graph-run" }),
        // canvas-layer.ts maps a skipped attempt's status to "idle" — there is
        // no separate "skipped" CanvasStatus.
        node("a", "run", { kind: "step", status: "idle" }),
      ];
      const { edges } = layoutTree(nodes, new Set(["run"]));
      expect(edges[0]!.state).toBeUndefined();
    });

    it("passes a declared back edge's own state through unchanged", () => {
      const nodes = [
        node("run", null, { kind: "graph-run" }),
        node("a", "run", { kind: "step" }),
        node("b", "run", { kind: "step" }),
      ];
      const edges: CanvasEdge[] = [{ from: "b", to: "a", variant: "back", state: "now" }];
      const { edges: placed } = layoutTree(nodes, new Set(["run"]), edges);
      expect(placed.find((edge) => edge.variant === "back")!.state).toBe("now");
    });

    it("leaves a declared edge without a state when none was given", () => {
      const nodes = [
        node("run", null, { kind: "graph-run" }),
        node("a", "run", { kind: "step" }),
        node("b", "run", { kind: "step" }),
      ];
      const edges: CanvasEdge[] = [{ from: "b", to: "a", variant: "back" }];
      const { edges: placed } = layoutTree(nodes, new Set(["run"]), edges);
      expect(placed.find((edge) => edge.variant === "back")!.state).toBeUndefined();
    });
  });

  describe("selected-path edges (BBP-220)", () => {
    it("highlights every tree edge from the root to a deeply nested selection, rest stays neutral", () => {
      const nodes = [
        node("run", null, { kind: "graph-run" }),
        node("a", "run", { kind: "step" }),
        node("b", "a", { kind: "step" }),
        node("c", "b", { kind: "step" }),
        node("sibling", "a", { kind: "step" }),
      ];
      const { edges } = layoutTree(nodes, new Set(["run", "a", "b"]), [], undefined, "c");
      const byTo = new Map(edges.map((edge) => [edge.to, edge]));
      expect(byTo.get("a")!.state).toBe("selected-path");
      expect(byTo.get("b")!.state).toBe("selected-path");
      expect(byTo.get("c")!.state).toBe("selected-path");
      expect(byTo.get("sibling")!.state).toBeUndefined();
    });

    it("negative: without a selection, no edge carries selected-path", () => {
      const nodes = [node("run", null, { kind: "graph-run" }), node("a", "run", { kind: "step" })];
      const { edges } = layoutTree(nodes, new Set(["run"]), [], undefined, null);
      expect(edges[0]!.state).toBeUndefined();
    });

    it("negative: a 'now' edge on the selected path is not degraded to selected-path", () => {
      const nodes = [
        node("run", null, { kind: "graph-run" }),
        node("a", "run", { kind: "step", status: "running" }),
        node("b", "a", { kind: "step" }),
      ];
      const { edges } = layoutTree(nodes, new Set(["run", "a"]), [], undefined, "b");
      const byTo = new Map(edges.map((edge) => [edge.to, edge]));
      expect(byTo.get("a")!.state).toBe("now");
      expect(byTo.get("b")!.state).toBe("selected-path");
    });

    it("negative: a relation edge never gets selected-path, even along the selection", () => {
      const nodes = [
        node("run", null, { kind: "graph-run" }),
        node("a", "run", { kind: "step" }),
        node("b", "run", { kind: "step" }),
      ];
      const edges: CanvasEdge[] = [{ from: "a", to: "b", variant: "back", relation: true }];
      const { edges: placed } = layoutTree(nodes, new Set(["run"]), edges, undefined, "b");
      const relation = placed.find((edge) => edge.relation);
      expect(relation!.state).toBeUndefined();
    });
  });

  describe("declared edge keeps its own variant (BBP-214 feedback 2)", () => {
    // A relation (BBP-202) running forward through the columns is declared
    // "flow", not "back" — `messageEdge` used to stamp every non-back
    // declared edge "message" regardless, so a `"flow"`-shaped relation
    // picked up the message dash pattern it never asked for, then rendered
    // blue once `relationsView` highlighted it: a dashed blue line with
    // nothing running.
    it("a declared 'flow' edge stays 'flow', not 'message' — no stray dash", () => {
      const nodes = [
        node("crew", null, { kind: "crew" }),
        node("a", "crew", { kind: "member" }),
        node("b", "crew", { kind: "member" }),
      ];
      const edges: CanvasEdge[] = [{ from: "a", to: "b", variant: "flow", relation: true }];
      const { edges: placed } = layoutTree(nodes, new Set(["crew"]), edges);
      const relation = placed.find((edge) => edge.relation);
      expect(relation!.variant).toBe("flow");
    });

    it("negative: a genuinely declared 'message' edge still renders as one", () => {
      const nodes = [node("a", null, { kind: "turn" }), node("b", null, { kind: "turn" })];
      const edges: CanvasEdge[] = [{ from: "a", to: "b", variant: "message" }];
      const { edges: placed } = layoutTree(nodes, new Set(), edges);
      expect(placed.find((edge) => edge.from === "a" && edge.to === "b")!.variant).toBe("message");
    });
  });

  describe("frames (BBP-165)", () => {
    function frameNodes(): CanvasNode[] {
      return [
        node("crew", null, { kind: "crew" }),
        node("lead", "crew", { kind: "member" }),
        node("m1", "crew", { kind: "member" }),
        node("m2", "crew", { kind: "member" }),
      ];
    }

    it("without a frames argument, returns bit-identical results to before (negative criterion 1)", () => {
      const nodes = frameNodes();
      const expanded = new Set(["crew"]);
      const withoutArg = layoutTree(nodes, expanded);
      const withEmptyEdges = layoutTree(nodes, expanded, []);
      expect(withoutArg).toEqual(withEmptyEdges);
      expect((withoutArg as { frames?: unknown }).frames).toBeUndefined();
    });

    it("computes a frame's bounding box plus padding from its member cards", () => {
      const nodes = frameNodes();
      const expanded = new Set(["crew"]);
      const frames: CanvasFrame[] = [{ id: "frame-crew", parentId: null, label: "crew" }];
      nodes[1] = { ...nodes[1]!, frameId: "frame-crew" };
      nodes[2] = { ...nodes[2]!, frameId: "frame-crew" };
      nodes[3] = { ...nodes[3]!, frameId: "frame-crew" };
      const { positions, frames: placedFrames } = layoutTree(nodes, expanded, [], frames);
      const members = positions.filter((p) => ["lead", "m1", "m2"].includes(p.id));
      const minX = Math.min(...members.map((p) => p.x));
      const minY = Math.min(...members.map((p) => p.y));
      const maxX = Math.max(...members.map((p) => p.x + p.width));
      const maxY = Math.max(...members.map((p) => p.y + p.height));
      const placed = placedFrames!.find((f) => f.id === "frame-crew")!;
      expect(placed.x).toBeLessThan(minX);
      expect(placed.y).toBeLessThan(minY);
      expect(placed.x + placed.width).toBeGreaterThan(maxX);
      expect(placed.y + placed.height).toBeGreaterThan(maxY);
    });

    it("drops a frame with no visible member nodes", () => {
      const nodes = frameNodes();
      const frames: CanvasFrame[] = [{ id: "empty-frame", parentId: null, label: "empty" }];
      const { frames: placedFrames } = layoutTree(nodes, new Set(["crew"]), [], frames);
      expect(placedFrames!.find((f) => f.id === "empty-frame")).toBeUndefined();
    });
  });
});

describe("frames and crew links (BBP-191)", () => {
  const crew: CanvasNode[] = [
    { id: "root", kind: "agents", label: "Agents", parentId: null },
    { id: "before", kind: "thread", label: "Before", parentId: "root" },
    { id: "a", kind: "thread", label: "a", parentId: "root", frameId: "frame:x" },
    { id: "b", kind: "thread", label: "b", parentId: "root", frameId: "frame:x" },
  ];
  const frames = [{ id: "frame:x", parentId: null, label: "x" }];

  it("keeps room above a frame for its label, clear of the card above it", () => {
    const layout = layoutTree(crew, new Set(["root"]), [], frames);
    const before = layout.positions.find((p) => p.id === "before")!;
    const frame = layout.frames!.find((f) => f.id === "frame:x")!;
    expect(frame.y).toBeGreaterThanOrEqual(before.y + before.height);
  });

  it("bows a link between two cards of one column out past their right edge", () => {
    const layout = layoutTree(crew, new Set(["root"]), [{ from: "a", to: "b", variant: "message", relation: true }], frames);
    const edge = layout.edges.find((e) => e.from === "a" && e.to === "b")!;
    const a = layout.positions.find((p) => p.id === "a")!;
    expect(edge.path).toContain(" C ");
    const laneX = Number(edge.path.split(" C ")[1]!.split(" ")[0]);
    expect(laneX).toBeGreaterThan(a.x + a.width);
  });
});

describe("flow layout for graph runs (BBP-303)", () => {
  const nodes: CanvasNode[] = [
    { id: "run", kind: "graph-run", label: "run", parentId: null, meta: { flow: true } },
    { id: "plan", kind: "thread", label: "plan", parentId: "run", meta: { step: true, layer: 0, lane: 0 } },
    { id: "a", kind: "thread", label: "a", parentId: "run", meta: { step: true, layer: 1, lane: 0 } },
    { id: "b", kind: "thread", label: "b", parentId: "run", meta: { step: true, layer: 1, lane: 1 } },
    { id: "join", kind: "thread", label: "join", parentId: "run", meta: { step: true, layer: 2, lane: 0 } },
    { id: "turn", kind: "turn", label: "turn of a", parentId: "a" },
  ];
  const edges: CanvasEdge[] = [
    { from: "plan", to: "a", variant: "step" },
    { from: "plan", to: "b", variant: "step" },
    { from: "a", to: "join", variant: "step" },
    { from: "b", to: "join", variant: "step" },
  ];
  const at = (layout: ReturnType<typeof layoutTree>, id: string) => layout.positions.find((p) => p.id === id)!;

  it("lays the steps out left to right by layer and stacks a layer's lanes", () => {
    const layout = layoutTree(nodes, new Set(["run"]), edges);
    expect(at(layout, "a").x).toBeGreaterThan(at(layout, "plan").x);
    expect(at(layout, "a").x).toBe(at(layout, "b").x);
    expect(at(layout, "b").y).toBeGreaterThan(at(layout, "a").y);
    expect(at(layout, "join").x).toBeGreaterThan(at(layout, "a").x);
  });

  it("joins the steps with step edges and hangs only the first layer off the run", () => {
    const layout = layoutTree(nodes, new Set(["run"]), edges);
    expect(layout.edges.filter((e) => e.from === "run").map((e) => e.to)).toEqual(["plan"]);
    expect(layout.edges.filter((e) => e.variant === "step")).toHaveLength(4);
  });

  it("opens a step's own activity below it and pushes the lanes beneath down", () => {
    const closed = layoutTree(nodes, new Set(["run"]), edges);
    const open = layoutTree(nodes, new Set(["run", "a"]), edges);
    const turn = at(open, "turn");
    expect(turn.y).toBeGreaterThan(at(open, "a").y + at(open, "a").height);
    expect(at(open, "b").y - at(open, "a").y).toBeGreaterThan(at(closed, "b").y - at(closed, "a").y);
  });
});
