// BBP-191: the standalone Canvas plugin's layer — runs only, under their thread.
import { describe, expect, it } from "vitest";
import { canvasExtensionLayer } from "../lib/canvas-layer";

const run = (id: string, threadId: string | null) =>
  ({
    id,
    projectId: "p1",
    threadId,
    status: "running",
    createdAt: 1,
    graph: { id: "g", name: `Graph ${id}`, nodes: [{ id: "a", label: "Step A" }], edges: [] },
    nodeRuns: [],
  }) as never;

describe("canvasExtensionLayer", () => {
  it("hangs a run under the canvas thread it was started from, with the project as fallback", () => {
    const layer = canvasExtensionLayer("p1", [run("r1", "t1")]);
    const node = layer.nodes.find((n) => n.kind === "graph-run")!;
    expect(node.parentId).toBe("thread:t1");
    expect(node.meta).toMatchObject({ fallbackParentId: "project:p1" });
    expect(layer.nodes.some((n) => n.label === "Step A" && n.meta?.step === true)).toBe(true);
    expect(layer.frames).toEqual([]);
  });

  it("hangs a run without a thread under its project and brings no crew level", () => {
    const layer = canvasExtensionLayer("p1", [run("r2", null)]);
    expect(layer.nodes.find((n) => n.kind === "graph-run")!.parentId).toBe("project:p1");
    expect(layer.nodes.some((n) => n.kind === "crew" || n.kind === "agents")).toBe(false);
  });
});

describe("canvasExtensionLayer progress and needs you (BBP-303)", () => {
  it("gives a run its progress and, while it waits, the question it waits on", () => {
    const waiting = {
      id: "r3",
      projectId: "p1",
      threadId: null,
      status: "waiting-human",
      createdAt: 1,
      graph: { id: "g", name: "G", nodes: [{ id: "a", label: "A" }, { id: "b", label: "Approve" }], edges: [] },
      nodeRuns: [{ nodeId: "a", attempt: 1, status: "done" }],
      pendingQuestion: { nodeId: "b", label: "Approve", question: "OK?" },
    } as never;
    const run = canvasExtensionLayer("p1", [waiting]).nodes.find((n) => n.kind === "graph-run")!;
    expect(run.meta).toMatchObject({ progress: ["done", "waiting"], needsYou: { runId: "r3", nodeId: "b", question: "OK?" } });
  });
});

describe("flow steps for the Canvas (BBP-303)", () => {
  const graph = {
    id: "g",
    name: "G",
    nodes: [
      { id: "plan", label: "plan", kind: "agent" },
      { id: "a", label: "A", kind: "agent" },
      { id: "b", label: "B", kind: "agent" },
      { id: "ok", label: "Approve", kind: "human" },
    ],
    edges: [
      { from: "plan", to: "a" },
      { from: "plan", to: "b" },
      { from: "a", to: "ok" },
      { from: "b", to: "ok" },
    ],
  };
  const run = {
    id: "r9",
    projectId: "p1",
    threadId: null,
    status: "waiting-human",
    createdAt: 1,
    graph,
    nodeRuns: [
      { nodeId: "plan", attempt: 1, status: "done", childThreadId: "thrPlan" },
      { nodeId: "a", attempt: 1, status: "done", childThreadId: "thrA" },
    ],
    pendingQuestion: { nodeId: "ok", label: "Approve", question: "OK?" },
  } as never;
  const layer = canvasExtensionLayer("p1", [run]);
  const byLabel = new Map(layer.nodes.map((n) => [n.label, n]));

  it("marks the run as a flow and draws each step that ran as its thread", () => {
    expect(layer.nodes.find((n) => n.kind === "graph-run")!.meta).toMatchObject({ flow: true });
    expect(byLabel.get("plan")).toMatchObject({ id: "thread:thrPlan", kind: "thread", meta: { threadId: "thrPlan", layer: 0 } });
  });

  it("puts parallel steps in one layer on two lanes, and a step not reached as an outline", () => {
    expect(byLabel.get("A")!.meta!.layer).toBe(byLabel.get("B")!.meta!.layer);
    expect(byLabel.get("A")!.meta!.lane).not.toBe(byLabel.get("B")!.meta!.lane);
    expect(byLabel.get("B")!.meta).toMatchObject({ ghost: true });
  });

  it("makes the human gate a waiting step and joins the steps with step edges", () => {
    expect(byLabel.get("Approve")).toMatchObject({ kind: "step", status: "waiting", meta: { gate: true, waitsForYou: { nodeId: "ok" } } });
    expect(layer.edges).toContainEqual(expect.objectContaining({ from: "thread:thrPlan", to: "thread:thrA", variant: "step" }));
  });
});
