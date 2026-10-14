// A left-to-right tree layout: pure and DOM-free, so the same function lays
// out a preview in a test and a live canvas on screen, and can be unit tested
// without a browser.
//
// Depth becomes a column, not a row — the opposite of graph-studio's
// top-to-bottom `layoutGraph` — because the view this feeds is a navigation
// tree read left to right (agents → project → crew → member → …), not a
// flow chart. Siblings (several members, several run steps) stack as rows
// within their shared column.
import { selectedPathEdges } from "./selected-path";
import type { CanvasEdge, CanvasEdgeState, CanvasFrame, CanvasNode } from "./types";
import { sizeOf, TIER_SIZE } from "./tiers";

/** Card tier's size, kept as the default export for callers that still want
 *  one constant (tests, the back-edge lane) — every node's own size now
 *  comes from `sizeOf(node.kind)` instead. */
export const NODE_WIDTH = TIER_SIZE.card.width;
export const NODE_HEIGHT = TIER_SIZE.card.height;
export const COLUMN_GAP = 44;
export const ROW_GAP = 16;
export const MARGIN = 24;
/** How far a back edge's arc bows out past the right edge of its column. */
const BACK_EDGE_LANE = 32;
/** Space between a frame's box and the cards it encloses. */
export const FRAME_PADDING = 16;
/** Room above a frame's first card for its label, kept free in the layout so
 *  neither the label nor the frame reach into the cards above (BBP-191). */
export const FRAME_HEAD = 22;

export type PlacedNode = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  column: number;
};

export type PlacedEdge = {
  from: string;
  to: string;
  variant: CanvasEdge["variant"];
  /** SVG path, ready for an `<svg><path/></svg>` or React Flow's `BaseEdge`. */
  path: string;
  label: string;
  /** A back reference bows out to the right instead of running straight down
   *  through the nodes in between. */
  isBack: boolean;
  /** Undefined draws the plain `--border` line from before BBP-146. */
  state?: CanvasEdgeState;
  relation?: boolean;
  emphasis?: CanvasEdge["emphasis"];
};

/** A frame's bounding box: the padded rectangle around its member cards. */
export type PlacedFrame = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type TreeLayout = {
  positions: PlacedNode[];
  edges: PlacedEdge[];
  width: number;
  height: number;
  /** Only present when a `frames` argument was given — absent, not empty, so
   *  a caller that never passed frames sees exactly the shape it did before
   *  BBP-165 (negative criterion 1). */
  frames?: PlacedFrame[];
};

/**
 * `nodes` is the full set a provider knows about; only the ones `expanded`
 * actually reveals end up in `positions` — a collapsed node's subtree is left
 * out of the layout entirely rather than placed off-screen.
 *
 * `edges` declares everything beyond the tree itself (back references,
 * messages); the parent/child line for every visible node is drawn
 * automatically and needs no entry here. An edge touching a node that is not
 * currently visible is dropped along with it.
 *
 * `selectedId` (BBP-220) highlights the flow edges from the root down to it
 * with `"selected-path"`, unless a given edge is already `"now"` — a running
 * child takes precedence over the selection.
 */
export function layoutTree(
  nodes: readonly CanvasNode[],
  expanded: ReadonlySet<string>,
  edges: readonly CanvasEdge[] = [],
  frames?: readonly CanvasFrame[],
  selectedId?: string | null,
): TreeLayout {
  const byId = new Map(nodes.map((node) => [node.id, node]));

  // A parent id absent from the node set roots its node instead of vanishing
  // it or throwing — a provider that forgot one ancestor must not take the
  // rest of the tree down with it.
  const parentOf = (node: CanvasNode): string | null =>
    node.parentId !== null && byId.has(node.parentId) ? node.parentId : null;

  const childrenOf = new Map<string | null, CanvasNode[]>();
  for (const node of nodes) {
    const key = parentOf(node);
    const list = childrenOf.get(key) ?? [];
    list.push(node);
    childrenOf.set(key, list);
  }

  const columnOf = new Map<string, number>();
  const parentIdOf = new Map<string, string | null>();
  const order: string[] = [];

  const visit = (parentId: string | null, column: number) => {
    for (const node of childrenOf.get(parentId) ?? []) {
      columnOf.set(node.id, column);
      parentIdOf.set(node.id, parentId);
      order.push(node.id);
      if (expanded.has(node.id)) visit(node.id, column + 1);
    }
  };
  visit(null, 0);

  // Every visible leaf takes the next free vertical slot, stacked by its own
  // tier height rather than a uniform row height — a "row"-tier leaf and a
  // "card"-tier leaf in the same column must not overlap. A parent centres
  // on the vertical span its open subtree's first and last child occupy, so
  // with 20 members under one crew the crew card sits beside the middle of
  // its members instead of above the first one and the fan of edges stays
  // short and symmetric.
  const visibleChildren = new Map<string, string[]>();
  for (const id of order) {
    const parentId = parentIdOf.get(id)!;
    if (parentId === null) continue;
    const list = visibleChildren.get(parentId) ?? [];
    list.push(id);
    visibleChildren.set(parentId, list);
  }
  const centerYOf = new Map<string, number>();
  let nextY = MARGIN;
  let lastFrame: string | undefined;
  const placeCenters = (id: string): number => {
    const kids = visibleChildren.get(id) ?? [];
    if (kids.length === 0) {
      const height = sizeOf(byId.get(id)!.kind).height;
      // Entering a frame: room for its padding and label above the card;
      // leaving one: room for its padding below the last card.
      const frame = byId.get(id)!.frameId;
      if (frame !== lastFrame) {
        if (lastFrame !== undefined) nextY += FRAME_PADDING;
        if (frame !== undefined) nextY += FRAME_PADDING + FRAME_HEAD;
        lastFrame = frame;
      }
      const top = nextY;
      nextY = top + height + ROW_GAP;
      const center = top + height / 2;
      centerYOf.set(id, center);
      return center;
    }
    const centers = kids.map(placeCenters);
    const center = (centers[0]! + centers[centers.length - 1]!) / 2;
    centerYOf.set(id, center);
    return center;
  };
  for (const id of order) if (parentIdOf.get(id) === null) placeCenters(id);

  // Column x grows by the widest node actually placed in the previous
  // column, not a single global width — a "group" and a "row" tier share
  // the same 220px today, but columns are free to differ.
  const columnWidth = new Map<number, number>();
  for (const id of order) {
    const column = columnOf.get(id)!;
    const width = sizeOf(byId.get(id)!.kind).width;
    columnWidth.set(column, Math.max(columnWidth.get(column) ?? 0, width));
  }
  const columnX = new Map<number, number>();
  let nextX = MARGIN;
  for (let column = 0; column <= Math.max(...[...columnOf.values()], -1); column++) {
    columnX.set(column, nextX);
    nextX += (columnWidth.get(column) ?? 0) + COLUMN_GAP;
  }

  const placed = new Map<string, PlacedNode>();
  for (const id of order) {
    const column = columnOf.get(id)!;
    const { width, height } = sizeOf(byId.get(id)!.kind);
    placed.set(id, {
      id,
      x: columnX.get(column)!,
      y: centerYOf.get(id)! - height / 2,
      width,
      height,
      column,
    });
  }

  const onSelectedPath = selectedPathEdges(selectedId ?? null, parentIdOf);
  // As agent-graph: the whole path from the root down to running work is
  // marked, not only the last edge into the running node (BBP-298).
  const runningBranch = new Set<string>();
  // The same for whatever waits for the human (BBP-303): its path turns amber.
  const needsBranch = new Set<string>();
  for (const node of nodes) {
    if (!node.meta?.needsYou) continue;
    for (let id = parentOf(node); id !== null && !needsBranch.has(id); id = parentOf(byId.get(id)!)) needsBranch.add(id);
  }
  for (const node of nodes) {
    if (node.status !== "running") continue;
    for (let id = parentOf(node); id !== null && !runningBranch.has(id); id = parentOf(byId.get(id)!)) runningBranch.add(id);
  }
  const flowEdges: PlacedEdge[] = order.flatMap((id) => {
    const parentId = parentIdOf.get(id)!;
    if (parentId === null) return [];
    return [flowEdge(placed.get(parentId)!, placed.get(id)!, byId.get(id)!, onSelectedPath.has(id), runningBranch.has(id), needsBranch.has(id))];
  });

  const declaredEdges: PlacedEdge[] = edges.flatMap((edge) => {
    const from = placed.get(edge.from);
    const to = placed.get(edge.to);
    if (!from || !to) return [];
    return [edge.variant === "back" ? backEdge(from, to, edge) : messageEdge(from, to, edge)];
  });

  // Derived from the actual placed extents rather than a per-column/per-row
  // constant — columns and rows now mix tier sizes, so only the nodes
  // themselves know how far the layout reaches.
  const allPlaced = [...placed.values()];
  const width =
    allPlaced.length === 0
      ? MARGIN * 2
      : MARGIN + Math.max(...allPlaced.map((p) => p.x + p.width)) + BACK_EDGE_LANE;
  const height =
    allPlaced.length === 0 ? MARGIN * 2 : MARGIN + Math.max(...allPlaced.map((p) => p.y + p.height));

  const layout: TreeLayout = {
    positions: [...placed.values()],
    edges: [...flowEdges, ...declaredEdges],
    width,
    height,
  };
  if (frames === undefined) return layout;
  return { ...layout, frames: placeFrames(frames, nodes, placed) };
}

/** A frame with no visible member node is dropped rather than drawn with an
 *  empty or default-sized box — a collapsed crew must not leave a stray
 *  rectangle behind. */
function placeFrames(
  frames: readonly CanvasFrame[],
  nodes: readonly CanvasNode[],
  placed: Map<string, PlacedNode>,
): PlacedFrame[] {
  const membersOf = new Map<string, PlacedNode[]>();
  for (const node of nodes) {
    if (!node.frameId) continue;
    const placedNode = placed.get(node.id);
    if (!placedNode) continue;
    const list = membersOf.get(node.frameId) ?? [];
    list.push(placedNode);
    membersOf.set(node.frameId, list);
  }

  return frames.flatMap((frame) => {
    const members = membersOf.get(frame.id);
    if (!members || members.length === 0) return [];
    const minX = Math.min(...members.map((m) => m.x));
    const minY = Math.min(...members.map((m) => m.y));
    const maxX = Math.max(...members.map((m) => m.x + m.width));
    const maxY = Math.max(...members.map((m) => m.y + m.height));
    return [
      {
        id: frame.id,
        x: minX - FRAME_PADDING,
        y: minY - FRAME_PADDING - FRAME_HEAD,
        width: maxX - minX + FRAME_PADDING * 2,
        height: maxY - minY + FRAME_PADDING * 2 + FRAME_HEAD,
      },
    ];
  });
}

/** A tree line's state follows the child it leads to, not a declared edge —
 *  there is no `CanvasEdge` for it to read one from. Only a child that is
 *  actually `running` lights the line up ("now"); a finished or failed child
 *  draws the plain neutral line like anything else — "taken" is gone
 *  (BBP-214 stage 1): a line to a `done` step must not look like ongoing
 *  activity. */
function flowEdgeState(child: CanvasNode, onSelectedPath: boolean, leadsToRunning = false, leadsToNeeds = false): CanvasEdgeState | undefined {
  // Waiting for the human outranks running: it is the one thing to act on.
  if (child.meta?.needsYou || leadsToNeeds) return "needs";
  if (child.status === "running" || leadsToRunning) return "now";
  return onSelectedPath ? "selected-path" : undefined;
}

function flowEdge(from: PlacedNode, to: PlacedNode, toNode: CanvasNode, onSelectedPath: boolean, leadsToRunning = false, leadsToNeeds = false): PlacedEdge {
  const fromX = from.x + from.width;
  const fromY = from.y + from.height / 2;
  const toX = to.x;
  const toY = to.y + to.height / 2;
  const midX = (fromX + toX) / 2;
  const path = [`M ${fromX} ${fromY}`, `C ${midX} ${fromY}, ${midX} ${toY}, ${toX} ${toY}`].join(" ");
  const state = flowEdgeState(toNode, onSelectedPath, leadsToRunning, leadsToNeeds);
  return { from: from.id, to: to.id, variant: "flow", path, label: "", isBack: false, ...(state ? { state } : {}) };
}

/** Bows out past the right edge of the column the edge starts in, so a loop
 *  reads as a loop instead of hiding behind the nodes between its ends. */
function backEdge(from: PlacedNode, to: PlacedNode, edge: CanvasEdge): PlacedEdge {
  const laneX = Math.max(from.x + from.width, to.x + to.width) + BACK_EDGE_LANE;
  const fromX = from.x + from.width;
  const fromY = from.y + from.height / 2;
  const toX = to.x + to.width;
  const toY = to.y + to.height / 2;
  const path = [`M ${fromX} ${fromY}`, `C ${laneX} ${fromY}, ${laneX} ${toY}, ${toX} ${toY}`].join(" ");
  return {
    from: from.id,
    to: to.id,
    variant: "back",
    path,
    label: edge.label ?? "",
    isBack: true,
    ...(edge.state ? { state: edge.state } : {}),
    ...relationOf(edge),
  };
}

/** The straight-line shape for every declared edge that isn't a back
 *  reference — a literal chat `message`, but also a relation (BBP-202,
 *  `relation: true`) declared with variant `"flow"` when it runs forward
 *  through the columns rather than looping back (`canvas-layer.ts`,
 *  `pathBetween`). The placed edge keeps the *declared* variant rather than
 *  always stamping `"message"`: `StatusEdge`'s dash pattern is keyed by
 *  variant, and a `"flow"`-shaped relation stamped `"message"` picked up a
 *  dash it never asked for (BBP-214 feedback 2) — only an edge actually
 *  declared `"message"` should look like one. */
function messageEdge(from: PlacedNode, to: PlacedNode, edge: CanvasEdge): PlacedEdge {
  const fromX = from.x + from.width / 2;
  const fromY = from.y + from.height / 2;
  const toX = to.x + to.width / 2;
  const toY = to.y + to.height / 2;
  // Two cards in one column (a crew's members): centre to centre runs under
  // the cards. Bow out past their right edge instead, further the further
  // apart they are, so the arcs of one crew nest instead of overlapping
  // (BBP-191).
  const sameColumn = Math.abs(from.x - to.x) < 1;
  const right = Math.max(from.x + from.width, to.x + to.width);
  const lane = right + 14 + Math.min(70, Math.abs(toY - fromY) / 5);
  const path = sameColumn
    ? `M ${right - 6} ${fromY} C ${lane} ${fromY}, ${lane} ${toY}, ${right - 6} ${toY}`
    : `M ${fromX} ${fromY} L ${toX} ${toY}`;
  return {
    from: from.id,
    to: to.id,
    variant: edge.variant,
    path,
    label: edge.label ?? "",
    isBack: false,
    ...(edge.state ? { state: edge.state } : {}),
    ...relationOf(edge),
  };
}

function relationOf(edge: CanvasEdge): Pick<PlacedEdge, "relation" | "emphasis"> {
  if (!edge.relation) return {};
  return { relation: true, ...(edge.emphasis ? { emphasis: edge.emphasis } : {}) };
}
