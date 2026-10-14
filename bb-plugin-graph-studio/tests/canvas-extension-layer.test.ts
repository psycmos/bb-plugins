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
    expect(layer.nodes.some((n) => n.kind === "step" && n.label === "Step A")).toBe(true);
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
