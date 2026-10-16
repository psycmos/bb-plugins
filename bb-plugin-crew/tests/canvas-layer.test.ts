import { describe, expect, it } from "vitest";
import { crewCanvasLayer, crewFrameId, crewNameFromFrameId, crewTopologyFrame, memberNodeId } from "../lib/canvas-layer";
import type { MemberInfo } from "../lib/contract";

const member = (over: Partial<MemberInfo>): MemberInfo => ({
  memberId: "m", address: "dev@trio", crew: "trio", key: "dev", groupId: "dev", lead: false, role: "",
  threadId: null, shift: null, activity: "idle", ...over,
});

describe("crewCanvasLayer", () => {
  it("hangs crews under the project and members under their crew, crews expanded, members carry the crew's frame id", () => {
    const layer = crewCanvasLayer("p1", [{ name: "trio", status: "running" }], [
      member({ address: "lead@trio", key: "lead", groupId: "orch", lead: true, activity: "working", threadId: "t1", role: "Leads" }),
      member({ address: "dev@trio", key: "dev", activity: "needs-you" }),
    ]);
    expect(layer.nodes).toEqual([
      { id: "crew:trio", kind: "crew", label: "trio", status: "running", parentId: "project:p1", meta: { crew: "trio", status: "running", members: 2, lead: "lead", active: 1 } },
      { id: "member:lead@trio", kind: "member", label: "lead", status: "running", parentId: "crew:trio", frameId: "frame:trio",
        meta: { address: "lead@trio", role: "Leads", lead: true, threadId: "t1", activity: "working" } },
      { id: "member:dev@trio", kind: "member", label: "dev", status: "waiting", parentId: "crew:trio", frameId: "frame:trio",
        meta: { address: "dev@trio", role: "", lead: false, threadId: null, activity: "needs-you" } },
    ]);
    expect(layer.expanded).toEqual(["crew:trio"]);
    expect(withoutLinks(layer.edges)).toEqual([]);
    expect(layer.frames).toEqual([{ id: "frame:trio", parentId: null, label: "trio" }]);
    expect(memberNodeId("dev@trio")).toBe("member:dev@trio");
  });

  it("negative: no crews → empty layer; unknown activity → no status; stopped crew is not expanded", () => {
    expect(crewCanvasLayer("p1", [], [])).toEqual({ nodes: [], edges: [], expanded: [], frames: [] });
    const layer = crewCanvasLayer("p1", [{ name: "old", status: "stopped" }], [member({ crew: "old", address: "a@old", activity: "unknown" })]);
    expect(layer.nodes[1]!.status).toBeUndefined();
    expect(layer.expanded).toEqual([]);
  });

  describe("crew status reflects member activity, not the plugin's own lifecycle (BBP-214 stage 1)", () => {
    it("negative: a running crew with only idle members shows no status (not 'running')", () => {
      const layer = crewCanvasLayer("p1", [{ name: "trio", status: "running" }], [
        member({ address: "lead@trio", key: "lead", lead: true, activity: "idle" }),
        member({ address: "dev@trio", key: "dev", activity: "idle" }),
      ]);
      expect(layer.nodes[0]!.status).toBeUndefined();
      expect(layer.nodes[0]!.meta).toMatchObject({ active: 0 });
    });

    it("a running crew with one working member shows 'running' and counts it in meta.active", () => {
      const layer = crewCanvasLayer("p1", [{ name: "trio", status: "running" }], [
        member({ address: "lead@trio", key: "lead", lead: true, activity: "idle" }),
        member({ address: "dev@trio", key: "dev", activity: "working" }),
      ]);
      expect(layer.nodes[0]!.status).toBe("running");
      expect(layer.nodes[0]!.meta).toMatchObject({ active: 1 });
    });

    it("a running crew with a member waiting on input shows 'waiting', not 'running'", () => {
      const layer = crewCanvasLayer("p1", [{ name: "trio", status: "running" }], [
        member({ address: "dev@trio", key: "dev", activity: "needs-you" }),
      ]);
      expect(layer.nodes[0]!.status).toBe("waiting");
    });

    it("a degraded crew always shows 'failed', a stopped one always 'idle', regardless of members", () => {
      const degraded = crewCanvasLayer("p1", [{ name: "trio", status: "degraded" }], [
        member({ address: "dev@trio", key: "dev", activity: "working" }),
      ]);
      expect(degraded.nodes[0]!.status).toBe("failed");
      const stopped = crewCanvasLayer("p1", [{ name: "trio", status: "stopped" }], [
        member({ address: "dev@trio", key: "dev", activity: "working" }),
      ]);
      expect(stopped.nodes[0]!.status).toBe("idle");
    });
  });

  describe("links (BBP-170)", () => {
    const trio = [
      member({ address: "lead@trio", key: "lead", groupId: "orch", lead: true }),
      member({ address: "dev@trio", key: "dev" }),
    ];

    it("turns a crew's declared links into edges between its member nodes, classified flow/back same as crewTopologyFrame", () => {
      const layer = crewCanvasLayer("p1", [{ name: "trio", status: "running" }], trio, {
        trio: [{ from: "lead", to: "dev", kind: "assigns_to" }],
      });
      expect(withoutLinks(layer.edges)).toEqual([{ from: "member:lead@trio", to: "member:dev@trio", variant: "flow", label: "assigns_to", relation: true }]);
    });

    it("negative: a link naming an unknown member, or a crew with no links entry, yields no edge", () => {
      const layer = crewCanvasLayer("p1", [{ name: "trio", status: "running" }], trio, {
        trio: [{ from: "lead", to: "ghost", kind: "assigns_to" }],
      });
      expect(withoutLinks(layer.edges)).toEqual([]);
      expect(crewCanvasLayer("p1", [{ name: "trio", status: "running" }], trio).edges).toEqual([]);
    });
  });
});

describe("crewCanvasLayer sidebar fields (BBP-179 acceptance)", () => {
  it("leaves out the lead when the crew has none, and counts zero members", () => {
    const layer = crewCanvasLayer("p1", [{ name: "solo", status: "stopped" }], []);
    expect(layer.nodes[0]!.meta).toEqual({ crew: "solo", status: "stopped", members: 0, active: 0 });
  });
});

describe("crewNameFromFrameId", () => {
  it("inverts crewFrameId", () => {
    expect(crewNameFromFrameId(crewFrameId("trio"))).toBe("trio");
    expect(crewNameFromFrameId("frame:my-crew_2")).toBe("my-crew_2");
  });
});

describe("canvasLayer RPC", () => {
  it("serves the crew layer with contractVersion", async () => {
    const { createFakePluginHost } = await import("@get-bb/plugin-sdk/testing");
    const { default: plugin } = await import("../server");
    const { bb, harness } = createFakePluginHost({ pluginId: "crew" });
    await plugin(bb);
    expect(await harness.behavior.callRpc("canvasLayer", { projectId: "p1" })).toEqual({ contractVersion: 1, nodes: [], edges: [], expanded: [], frames: [] });
    await harness.lifecycle.dispose();
  });

  it("keeps relation and links on link edges through the RPC output schema (BBP-197 fix)", async () => {
    const { rpcContract } = await import("../server");
    const layer = {
      contractVersion: 1,
      ...crewCanvasLayer("p1", [{ name: "trio", status: "running" }], [
        { crew: "trio", key: "lead", lead: true, groupId: "orch", activity: "idle" },
        { crew: "trio", key: "dev", lead: false, groupId: "impl", activity: "idle" },
      ] as never, { trio: [{ from: "lead", to: "dev", kind: "assigns_to" }, { from: "dev", to: "lead", kind: "escalates_to" }] }),
    };
    const parsed = rpcContract.canvasLayer.output.parse(layer);
    expect(parsed.edges).toEqual(layer.edges);
    expect(parsed.edges[0]).toMatchObject({ relation: true, links: [{ kind: "assigns_to" }, { kind: "escalates_to" }] });
  });
});

/** The edges as before BBP-203; `links` gets its own test. */
const withoutLinks = (edges: readonly { links?: unknown }[]) => edges.map(({ links: _links, ...edge }) => edge);

describe("crewTopologyFrame", () => {
  // Shaped like a crew.yaml: lead in group "orch", two devs in "dev", links between them.
  const members = [
    { key: "dev-a", groupId: "dev", lead: false },
    { key: "lead", groupId: "orch", lead: true },
    { key: "dev-b", groupId: "dev", lead: false },
  ];
  const links = [
    { from: "lead", to: "dev-a", kind: "assigns_to" },
    { from: "dev-a", to: "dev-b", kind: "works_with" },
    { from: "dev-b", to: "lead", kind: "escalates_to" },
  ];

  it("frames the crew, orders lead first then groups, members carry the frame id", () => {
    const topo = crewTopologyFrame("trio", members, links);
    expect(topo.frames).toEqual([{ id: "frame:trio", parentId: null, label: "trio" }]);
    expect(topo.nodes.map((node) => node.id)).toEqual(["member:lead@trio", "member:dev-a@trio", "member:dev-b@trio"]);
    expect(topo.nodes.every((node) => node.frameId === "frame:trio" && node.kind === "member")).toBe(true);
    expect(topo.nodes[0]).toMatchObject({ label: "lead", parentId: null, meta: { lead: true, groupId: "orch", layer: 0 } });
    expect(topo.nodes[1]!.meta).toMatchObject({ layer: 1, groupId: "dev" });
  });

  it("turns links into edges, the shape from pathBetween picking flow or back", () => {
    const topo = crewTopologyFrame("trio", members, links);
    expect(withoutLinks(topo.edges)).toEqual([
      { from: "member:lead@trio", to: "member:dev-a@trio", variant: "flow", label: "assigns_to", relation: true },
      { from: "member:dev-a@trio", to: "member:dev-b@trio", variant: "flow", label: "works_with", relation: true },
      { from: "member:dev-b@trio", to: "member:lead@trio", variant: "back", label: "escalates_to", relation: true },
    ]);
  });

  it("negative: links to unknown members or to self are dropped; empty crew still yields its frame", () => {
    const topo = crewTopologyFrame("trio", members, [
      { from: "lead", to: "ghost", kind: "assigns_to" },
      { from: "lead", to: "lead", kind: "works_with" },
    ]);
    expect(withoutLinks(topo.edges)).toEqual([]);
    expect(crewTopologyFrame("empty", [], [])).toEqual({ frames: [{ id: "frame:empty", parentId: null, label: "empty" }], nodes: [], edges: [] });
  });

  it("a bundled edge keeps its single links by node id for the sidebar (BBP-203)", () => {
    const topo = crewTopologyFrame("trio", members, [
      { from: "lead", to: "dev-a", kind: "assigns_to" },
      { from: "dev-a", to: "lead", kind: "escalates_to" },
      { from: "lead", to: "ghost", kind: "assigns_to" },
    ]);
    expect(topo.edges.map((edge) => edge.links)).toEqual([
      [
        { from: "member:lead@trio", to: "member:dev-a@trio", kind: "assigns_to" },
        { from: "member:dev-a@trio", to: "member:lead@trio", kind: "escalates_to" },
      ],
    ]);
  });

  describe("bundles links per node pair (BBP-201)", () => {
    const pair = [
      { key: "lead", lead: true, groupId: "orch" },
      { key: "dev", lead: false, groupId: "impl" },
    ] as const;

    it("one link stays one edge with its kind as label", () => {
      const topo = crewTopologyFrame("t", pair, [{ from: "lead", to: "dev", kind: "assigns_to" }]);
      expect(withoutLinks(topo.edges)).toEqual([{ from: "member:lead@t", to: "member:dev@t", variant: "flow", label: "assigns_to", relation: true }]);
    });

    it("two opposite links become one edge in the first link's direction, label forward ⇄ back", () => {
      const topo = crewTopologyFrame("t", pair, [
        { from: "lead", to: "dev", kind: "assigns_to" },
        { from: "dev", to: "lead", kind: "escalates_to" },
      ]);
      expect(withoutLinks(topo.edges)).toEqual([{ from: "member:lead@t", to: "member:dev@t", variant: "flow", label: "assigns_to ⇄ escalates_to", relation: true }]);
    });

    it("several links in the same direction join with commas, duplicates once", () => {
      const topo = crewTopologyFrame("t", pair, [
        { from: "lead", to: "dev", kind: "assigns_to" },
        { from: "lead", to: "dev", kind: "works_with" },
        { from: "lead", to: "dev", kind: "assigns_to" },
        { from: "dev", to: "lead", kind: "escalates_to" },
      ]);
      expect(withoutLinks(topo.edges)).toEqual([
        { from: "member:lead@t", to: "member:dev@t", variant: "flow", label: "assigns_to, works_with ⇄ escalates_to", relation: true },
      ]);
    });
  });
});
