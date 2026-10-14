// BBP-190: hangs the extensions' layers (crews today, graph runs later) into
// the canvas's own overview. A crew member that runs in a thread *is* that
// thread on the canvas: one card, under its crew, that opens to the thread's
// turns and tool calls like any thread — never a member card beside a thread
// card for the same agent.
import type { CanvasEdge, CanvasFrame, CanvasNode } from "../vendor/bb-canvas/lib/types";
import { threadNodeId } from "../vendor/bb-canvas/lib/canvas-threads";
import type { ExtensionLayer } from "./extensions";

export type Merged = { nodes: CanvasNode[]; edges: CanvasEdge[]; expanded: string[]; frames: CanvasFrame[] };

/** What the thread list knows about a member's thread. */
export type ThreadFacts = { providerId?: string; environmentBranchName?: string | null; status?: string };

export function mergeExtensions(
  base: { nodes: readonly CanvasNode[]; edges: readonly CanvasEdge[]; expanded: readonly string[] },
  layer: ExtensionLayer | null,
  threads: ReadonlyMap<string, ThreadFacts> = new Map(),
): Merged {
  if (!layer || layer.nodes.length === 0) return { nodes: [...base.nodes], edges: [...base.edges], expanded: [...base.expanded], frames: [] };
  const extNodes = layer.nodes as unknown as CanvasNode[];
  // member id -> its thread's node id, for every member that runs in a thread
  const rename = new Map<string, string>();
  for (const node of extNodes) {
    const threadId = node.meta?.threadId;
    if (node.kind === "member" && typeof threadId === "string" && threadId !== "") rename.set(node.id, threadNodeId(threadId));
  }
  const to = (id: string) => rename.get(id) ?? id;
  const taken = new Set(rename.values());
  // The overview's own card of a member's thread gives way to the member.
  const own = base.nodes.filter((node) => !taken.has(node.id));
  const ownIds = new Set(own.map((node) => node.id));
  const added: CanvasNode[] = [];
  for (const node of extNodes) {
    const id = to(node.id);
    const parentId = node.parentId === null ? null : to(node.parentId);
    // A crew of a project the overview does not show has nowhere to hang.
    if (parentId !== null && !ownIds.has(parentId) && !extNodes.some((other) => to(other.id) === parentId)) continue;
    const member = rename.has(node.id);
    added.push({
      ...node,
      id,
      parentId,
      // A member with a thread is drawn and opened as that thread.
      ...(member ? { kind: "thread" as const, meta: memberMeta(node, threads.get(String(node.meta?.threadId))) } : {}),
    });
  }
  const kept = new Set([...ownIds, ...added.map((node) => node.id)]);
  // A project tells its threads and its crews apart.
  const crewsOf = new Map<string, number>();
  for (const node of added) if (node.kind === "crew" && node.parentId !== null) crewsOf.set(node.parentId, (crewsOf.get(node.parentId) ?? 0) + 1);
  const ownWithCounts = own.map((node) => (crewsOf.has(node.id) ? { ...node, meta: { ...node.meta, crews: crewsOf.get(node.id) } } : node));
  const edges = [
    ...base.edges.filter((edge) => kept.has(edge.from) && kept.has(edge.to)),
    ...(layer.edges as unknown as CanvasEdge[]).map((edge) => ({ ...edge, from: to(edge.from), to: to(edge.to) })).filter((edge) => kept.has(edge.from) && kept.has(edge.to)),
  ];
  const frames = (layer.frames as unknown as CanvasFrame[]).map((frame) => frame);
  return {
    nodes: [...ownWithCounts, ...added],
    edges,
    expanded: [...base.expanded.filter((id) => kept.has(id)), ...layer.expanded.map(to).filter((id) => kept.has(id))],
    frames,
  };
}

function memberMeta(node: CanvasNode, facts: ThreadFacts | undefined): Record<string, unknown> {
  return {
    ...node.meta,
    member: true,
    threadId: node.meta?.threadId,
    ...(facts?.providerId ? { provider: facts.providerId } : {}),
    ...(facts?.environmentBranchName ? { branch: facts.environmentBranchName } : {}),
    ...(facts?.status ? { state: facts.status } : {}),
  };
}
