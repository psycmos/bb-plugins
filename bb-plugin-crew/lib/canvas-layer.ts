// Crew's part of the shared canvas (BBP-131): crews and their members as
// bb-canvas nodes, served as the `canvasLayer` RPC so graph-studio can draw
// them on its page. Pure, so the mapping is testable without a store.
//
// One page only: graph-studio shows the canvas whenever it is active and
// pulls this layer in; crew shows it itself only while graph-studio is not.
import type { CanvasLayer } from "../vendor/bb-canvas/lib/layer";
import { projectNodeId } from "../vendor/bb-canvas/lib/layer";
import type { CanvasEdge, CanvasFrame, CanvasNode, CanvasStatus, RelationLink } from "../vendor/bb-canvas/lib/types";
import { crewLayers, pathBetween, placeLayers, type CrewMemberRef } from "./canvas-layout";
import type { MemberInfo } from "./contract";
import type { CrewStatus } from "./store";

export const crewNodeId = (crew: string): string => `crew:${crew}`;
export const memberNodeId = (address: string): string => `member:${address}`;

const ACTIVITY_STATUS: Record<string, CanvasStatus> = {
  working: "running",
  idle: "idle",
  "needs-you": "waiting",
  error: "failed",
};

/** A crew's own lifecycle status (`running` = created and not stopped) is not
 *  activity: a crew with every member idle must read as neutral, not light up
 *  blue just because nobody asked it to stop (BBP-214 Befund 19:17). Only
 *  `stopped` and `degraded` are taken from the crew itself; `running` and
 *  `starting` are derived from what its members are actually doing. */
function deriveCrewStatus(status: CrewStatus, members: MemberInfo[]): CanvasStatus | undefined {
  if (status === "stopped") return "idle";
  if (status === "degraded") return "failed";
  if (members.some((member) => member.activity === "working")) return "running";
  if (members.some((member) => member.activity === "needs-you")) return "waiting";
  return status === "starting" ? "waiting" : undefined;
}

/** A crew's declared links (BBP-170): the same ones `crewTopologyFrame`
 *  classifies into flow/back edges, keyed by crew name. */
export type CrewLinks = Record<string, readonly { from: string; to: string; kind: string }[]>;

export type CrewCanvasLayer = CanvasLayer & {
  /** One frame per crew (BBP-170 WI6), drawn around its member nodes on the
   *  same project→crew→member tree — not a separate page. */
  frames: CanvasFrame[];
};

export function crewCanvasLayer(
  projectId: string,
  crews: { name: string; status: CrewStatus }[],
  members: MemberInfo[],
  linksByCrew: CrewLinks = {},
): CrewCanvasLayer {
  const layer: CrewCanvasLayer = { nodes: [], edges: [], expanded: [], frames: [] };
  for (const crew of crews) {
    const id = crewNodeId(crew.name);
    const crewMembers = members.filter((entry) => entry.crew === crew.name);
    const lead = crewMembers.find((entry) => entry.lead)?.key;
    const status = deriveCrewStatus(crew.status, crewMembers);
    const active = crewMembers.filter((entry) => entry.activity === "working").length;
    layer.nodes.push({
      id,
      kind: "crew",
      label: crew.name,
      ...(status ? { status } : {}),
      parentId: projectNodeId(projectId),
      meta: { crew: crew.name, status: crew.status, members: crewMembers.length, ...(lead ? { lead } : {}), active },
    });
    // A stopped crew stays folded: its members have nothing to show.
    if (crew.status !== "stopped") layer.expanded.push(id);
    // The frame and its flow/back-classified edges come from the same
    // topology math the edit mode uses (crewTopologyFrame) — one
    // classification, not two, so run view and edit view never disagree on
    // which link bows out as a back edge.
    const topology = crewTopologyFrame(
      crew.name,
      crewMembers.map((entry) => ({ key: entry.key, groupId: entry.groupId, lead: entry.lead })),
      linksByCrew[crew.name] ?? [],
    );
    layer.frames.push(...topology.frames);
    layer.edges.push(...topology.edges);
    for (const member of crewMembers) {
      const status = ACTIVITY_STATUS[member.activity];
      layer.nodes.push({
        id: memberNodeId(member.address),
        kind: "member",
        label: member.key,
        ...(status ? { status } : {}),
        parentId: id,
        frameId: crewFrameId(crew.name),
        meta: { address: member.address, role: member.role, lead: member.lead, threadId: member.threadId, activity: member.activity },
      });
    }
  }
  return layer;
}

export type CrewTopology = { frames: CanvasFrame[]; nodes: (CanvasNode & { frameId: string })[]; edges: CanvasEdge[] };

export const crewFrameId = (crew: string): string => `frame:${crew}`;

/** The inverse of `crewFrameId` — crew names never contain ":" (BBP-170 WI6). */
export const crewNameFromFrameId = (frameId: string): string => frameId.slice("frame:".length);

/**
 * One crew's topology as a bb-canvas frame (BBP-163): the lead and its
 * members inside one frame, in canvas-layout's row order (lead first, then
 * the groups in file order), and the crew's links as edges. A link that
 * points back up (pathBetween's "back" shape) becomes a back edge, the rest
 * flow edges. Links to unknown members or to oneself are dropped; several
 * links between one pair of members bundle into one edge. Every edge is a
 * relation (BBP-202): bb-canvas draws it only on demand.
 */
export function crewTopologyFrame(
  crew: string,
  members: readonly CrewMemberRef[],
  links: readonly { from: string; to: string; kind: string }[],
): CrewTopology {
  const frameId = crewFrameId(crew);
  const nodeId = (key: string) => memberNodeId(`${key}@${crew}`);
  const layers = crewLayers(members);
  const placed = placeLayers(layers, { width: 1, height: 1 });
  const boxes = new Map(placed.boxes.map((box) => [box.id, box]));
  const byKey = new Map(members.map((member) => [member.key, member]));
  const nodes = placed.boxes.map((box) => {
    const member = byKey.get(box.id)!;
    return {
      id: nodeId(member.key),
      kind: "member" as const,
      label: member.key,
      parentId: null,
      frameId,
      meta: { lead: member.lead, groupId: member.groupId, layer: box.layer },
    };
  });
  // One edge per node pair (BBP-201): the first link sets the direction,
  // links the other way join the label after "⇄".
  const pairs = new Map<string, { from: string; to: string; forward: Set<string>; back: Set<string>; links: RelationLink[] }>();
  for (const link of links) {
    if (link.from === link.to || !boxes.has(link.from) || !boxes.has(link.to)) continue;
    const reverse = pairs.get(`${link.to}\n${link.from}`);
    const pair = reverse ?? pairs.get(`${link.from}\n${link.to}`) ?? { from: link.from, to: link.to, forward: new Set<string>(), back: new Set<string>(), links: [] };
    const kinds = reverse ? pair.back : pair.forward;
    if (kinds.has(link.kind)) continue;
    kinds.add(link.kind);
    pair.links.push({ from: nodeId(link.from), to: nodeId(link.to), kind: link.kind });
    if (!reverse) pairs.set(`${link.from}\n${link.to}`, pair);
  }
  const edges: CanvasEdge[] = [...pairs.values()].map((pair) => ({
    from: nodeId(pair.from),
    to: nodeId(pair.to),
    variant: pathBetween(boxes.get(pair.from)!, boxes.get(pair.to)!).shape === "back" ? "back" : "flow",
    relation: true,
    links: pair.links,
    label: [[...pair.forward].join(", "), [...pair.back].join(", ")].filter(Boolean).join(" ⇄ "),
  }));
  return { frames: [{ id: frameId, parentId: null, label: crew }], nodes, edges };
}

export const GRAPH_STUDIO_PLUGIN_ID = "graph-studio";

