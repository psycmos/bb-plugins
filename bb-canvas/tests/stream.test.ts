import { describe, expect, it } from "vitest";
import { defaultLines, groupSteps, STREAM_HEAD, STREAM_LINE, STREAM_MAX_LINES, streamId, streamLabel, streamTurns } from "../lib/stream";
import { sizeOfNode, TIER_SIZE } from "../lib/tiers";
import type { CanvasNode } from "../lib/types";

const turn: CanvasNode = { id: "t", kind: "turn", label: "Turn", parentId: "thread:a", meta: { turnId: "t" } };
const msg = (id: string, parentId = "t"): CanvasNode => ({ id, kind: "turn", label: id, parentId, meta: { kind: "conversation" } });
const tool = (id: string, parentId = "t", status?: CanvasNode["status"]): CanvasNode => ({ id, kind: "tool-call", label: id, parentId, ...(status ? { status } : {}) });

describe("groupSteps", () => {
  it("puts each tool call under the message before it", () => {
    const groups = groupSteps([tool("a"), msg("m1"), tool("b"), tool("c"), msg("m2")]);
    expect(groups.map((g) => [g.message?.id, g.steps.map((s) => s.id)])).toEqual([
      [undefined, ["a"]],
      ["m1", ["b", "c"]],
      ["m2", []],
    ]);
  });
});

describe("defaultLines", () => {
  it("counts every message but only the newest group's steps", () => {
    expect(defaultLines(groupSteps([msg("m1"), tool("a"), tool("b"), msg("m2"), tool("c")]))).toBe(3);
  });
});

describe("streamTurns", () => {
  it("replaces a turn's messages and tool calls with one stream", () => {
    const { nodes, owner } = streamTurns([turn, msg("m1"), tool("a"), tool("b", "t", "running")]);
    expect(nodes.map((n) => n.id)).toEqual(["t", streamId("t")]);
    const stream = nodes[1]!;
    expect(stream.parentId).toBe("t");
    expect(stream.label).toBe("1 message · 2 steps");
    expect(stream.status).toBe("running");
    expect(owner.get("a")).toBe(streamId("t"));
    expect(sizeOfNode(stream).height).toBe(STREAM_HEAD + 3 * STREAM_LINE);
  });

  it("caps the stream's height at the most lines it shows", () => {
    const many = Array.from({ length: 40 }, (_, i) => tool(`s${i}`));
    const stream = streamTurns([turn, msg("m"), ...many]).nodes[1]!;
    expect(sizeOfNode(stream).height).toBe(STREAM_HEAD + STREAM_MAX_LINES * STREAM_LINE);
  });

  it("dissolves a '+N earlier' node into the stream", () => {
    const earlier: CanvasNode = { id: "t:earlier", kind: "system-event", label: "+1 earlier", parentId: "t", meta: { earlier: 1 } };
    const { nodes } = streamTurns([turn, earlier, tool("old", "t:earlier"), msg("m")]);
    expect(nodes.map((n) => n.id)).toEqual(["t", streamId("t")]);
    expect(nodes[1]!.label).toBe("1 message · 1 step");
  });

  it("leaves a subagent as a card of its own, and a non-running stream without status", () => {
    const sub: CanvasNode = { id: "sub", kind: "subagent", label: "sub", parentId: "t" };
    const { nodes } = streamTurns([turn, tool("a"), sub, tool("x", "sub")]);
    expect(nodes.map((n) => n.id)).toEqual(["t", streamId("t"), "sub", "x"]);
    expect(nodes[1]!.status).toBeUndefined();
  });

  it("leaves nodes outside a turn untouched", () => {
    const thread: CanvasNode = { id: "thread:a", kind: "thread", label: "A", parentId: null };
    const loose = tool("loose", "thread:a");
    const { nodes, owner } = streamTurns([thread, loose]);
    expect(nodes).toEqual([thread, loose]);
    expect(owner.size).toBe(0);
  });
});

describe("sizeOfNode", () => {
  it("keeps the tier's size without a meta.size", () => {
    expect(sizeOfNode(tool("a"))).toEqual(TIER_SIZE.row);
  });
});

describe("streamLabel", () => {
  it("names messages and steps", () => {
    expect(streamLabel(2, 5)).toBe("2 messages · 5 steps");
    expect(streamLabel(1, 1)).toBe("1 message · 1 step");
  });

  it("negative: leaves a zero part out, but never says nothing", () => {
    expect(streamLabel(0, 4)).toBe("4 steps");
    expect(streamLabel(3, 0)).toBe("3 messages");
    expect(streamLabel(0, 0)).toBe("0 steps");
  });
});
