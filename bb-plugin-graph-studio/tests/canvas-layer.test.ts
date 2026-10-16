import { describe, expect, it } from "vitest";
import { graphCanvasLayer, type CanvasRun } from "../lib/canvas-layer";
import { graphSchema } from "../lib/graph";

// a → b → c, c loops back to a.
const graph = graphSchema.parse({
  id: "loop",
  name: "Loop",
  nodes: [
    { id: "a", label: "Plan" },
    { id: "b", label: "Build" },
    { id: "c", label: "Check" },
  ],
  edges: [
    { from: "__start__", to: "a" },
    { from: "a", to: "b" },
    { from: "b", to: "c" },
    { from: "c", to: "a", label: "retry" },
    { from: "c", to: "__end__" },
  ],
});

const run = (over: Partial<CanvasRun>): CanvasRun => ({
  id: "r1", graph, status: "done", threadId: null, createdAt: 1, nodeRuns: [], ...over,
});

describe("graphCanvasLayer", () => {
  it("draws a run with its steps in graph order, latest attempt's status, and the loop as a back edge", () => {
    const layer = graphCanvasLayer("p1", [
      run({ status: "running", nodeRuns: [
        { nodeId: "a", attempt: 1, status: "failed" },
        { nodeId: "a", attempt: 2, status: "done" },
        { nodeId: "b", attempt: 1, status: "running" },
      ] }),
    ], new Map());
    expect(layer.nodes[0]).toMatchObject({ id: "graph-run:r1", kind: "graph-run", label: "Loop", status: "running", parentId: "project:p1",
      meta: { runId: "r1", steps: "1/3", progress: ["done", "running", "todo"], flow: true } });
    expect(layer.nodes.slice(1).map((n) => [n.id, n.status, n.meta?.attempts])).toEqual([
      ["step:r1:a", "done", 2],
      ["step:r1:b", "running", 1],
      ["step:r1:c", undefined, 0],
    ]);
    expect(layer.edges.filter((e) => e.variant === "back")).toEqual([{ from: "step:r1:c", to: "step:r1:a", variant: "back", label: "retry" }]);
    expect(layer.expanded).toEqual([]);
  });

  it("hangs a run under the member whose thread started it, and folds older finished runs into +N runs", () => {
    const members = new Map([["t1", "member:dev@trio"]]);
    const layer = graphCanvasLayer("p1", [
      run({ id: "old1", threadId: "t1", createdAt: 1 }),
      run({ id: "new", threadId: "t1", createdAt: 3 }),
      run({ id: "old2", threadId: "t1", createdAt: 2, status: "failed" }),
      run({ id: "live", threadId: "t1", createdAt: 0, status: "waiting-human" }),
    ], members);
    const runs = layer.nodes.filter((node) => node.kind === "graph-run");
    expect(runs.map((node) => [node.id, node.parentId, node.label])).toEqual([
      ["graph-run:new", "member:dev@trio", "Loop"],
      ["graph-run:live", "member:dev@trio", "Loop"],
      ["more-runs:member:dev@trio", "member:dev@trio", "+2 runs"],
      ["graph-run:old2", "more-runs:member:dev@trio", "Loop"],
      ["graph-run:old1", "more-runs:member:dev@trio", "Loop"],
    ]);
    expect(runs.find((node) => node.id === "graph-run:live")!.status).toBe("waiting");
    expect(layer.expanded).toEqual([]);
  });

  it("negative: no runs → empty layer; a run of a thread no member owns sits under the project", () => {
    expect(graphCanvasLayer("p1", [], new Map())).toEqual({ nodes: [], edges: [], expanded: [] });
    const layer = graphCanvasLayer("p1", [run({ threadId: "stranger" })], new Map([["t1", "member:x"]]));
    expect(layer.nodes[0]!.parentId).toBe("project:p1");
  });
});

describe("graphCanvasLayer sidebar fields (BBP-179 acceptance)", () => {
  it("leaves out a missing start time and counts no done steps as 0", () => {
    const layer = graphCanvasLayer("p1", [run({ createdAt: 0 })], new Map());
    expect(layer.nodes[0]!.meta).not.toHaveProperty("started");
    expect(layer.nodes[0]!.meta).toMatchObject({ steps: "0/3" });
  });
});

describe("back-edge state (BBP-146 AC 7)", () => {
  const loop = (target: "running" | "done" | "skipped") =>
    graphCanvasLayer("p1", [run({ status: "running", nodeRuns: [
      { nodeId: "a", attempt: 1, status: "done" },
      { nodeId: "b", attempt: 1, status: "done" },
      { nodeId: "c", attempt: 1, status: "done" },
      { nodeId: "a", attempt: 2, status: target },
    ] })], new Map()).edges.filter((e) => e.variant === "back");

  it("is 'now' only while the loop's target runs its second attempt", () => {
    expect(loop("running")).toEqual([{ from: "step:r1:c", to: "step:r1:a", variant: "back", label: "retry", state: "now" }]);
  });

  it("negative: a finished loop, a first attempt only, or a skipped second one, leaves the back edge without state (BBP-214 stage 1: 'taken' removed)", () => {
    expect(loop("done")[0]).not.toHaveProperty("state");
    expect(loop("skipped")[0]).not.toHaveProperty("state");
    const first = graphCanvasLayer("p1", [run({ nodeRuns: [{ nodeId: "a", attempt: 1, status: "running" }] })], new Map()).edges;
    expect(first[0]).not.toHaveProperty("state");
  });
});

it("negative: a step retried in place (no attempt at the loop's source) does not mark the back edge", () => {
  const edges = graphCanvasLayer("p1", [run({ nodeRuns: [
    { nodeId: "a", attempt: 1, status: "failed" },
    { nodeId: "a", attempt: 2, status: "running" },
  ] })], new Map()).edges;
  expect(edges[0]).not.toHaveProperty("state");
});
