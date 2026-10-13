// The React Flow hull around a `TreeLayout`: theme, zoom controls, pan and
// zoom at the pointer. No MiniMap and no keyboard here — those are the next
// work item, built on fixture data before either plugin feeds this component
// real data.
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type ColorMode,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { layoutTree, type PlacedEdge, type TreeLayout } from "../lib/layout";
import { NodeCard, type NodeCardProps } from "./NodeCard";
import { Frame, type FrameProps } from "./Frame";
import { describeNode, KindIcon } from "./KindIcon";
import { StatusEdge, type StatusEdgeData } from "./StatusEdge";
import type { CanvasEdge, CanvasFrame, CanvasNode } from "../lib/types";
import { MOTION_CSS, MOTION_MS, planMotion } from "../lib/tree-motion";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function usePrefersReducedMotion(): boolean {
  const query = () => typeof matchMedia === "function" && matchMedia(REDUCED_MOTION_QUERY).matches;
  const [reduced, setReduced] = useState(query);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const media = matchMedia(REDUCED_MOTION_QUERY);
    const update = () => setReduced(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return reduced;
}

/** The next nodes tagged for motion (BBP-200), plus the removed ones as
 *  ghosts that fade out and are dropped after `MOTION_MS`. The diff is taken
 *  against the nodes on screen when the set of ids last changed — the flow
 *  nodes are rebuilt on every render (a selection, say), and diffing against
 *  the last render would turn a just-entered node into a kept one at once. */
function useNodeMotion(next: Node[], reducedMotion: boolean): Node[] {
  const key = next.map((node) => node.id).join("\n");
  const last = useRef<Node[] | null>(null);
  const base = useRef<{ key: string; previous: Node[] | null }>({ key, previous: null });
  if (base.current.key !== key) base.current = { key, previous: last.current };
  const previous = base.current.previous;
  const plan = useMemo(() => planMotion(previous, next, reducedMotion), [previous, next, reducedMotion]);
  const [ghosts, setGhosts] = useState<Node[]>([]);
  useEffect(() => {
    last.current = next;
  });
  useEffect(() => {
    // The cleanup below cancelled the previous fade's timer, so its ghosts
    // go now rather than linger.
    setGhosts(plan.exiting);
    if (plan.exiting.length === 0) return;
    const timer = setTimeout(() => setGhosts([]), MOTION_MS);
    return () => clearTimeout(timer);
    // Only a new id set starts a fade-out; `plan` is rebuilt on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return useMemo(() => {
    if (reducedMotion || ghosts.length === 0) return plan.nodes;
    const present = new Set(plan.nodes.map((node) => node.id));
    // A ghost is gone from the tree: hidden from assistive tech and queries.
    const fading = ghosts.filter((ghost) => !present.has(ghost.id)).map((ghost) => ({ ...ghost, domAttributes: { "aria-hidden": true } }));
    return [...plan.nodes, ...fading];
  }, [plan, ghosts, reducedMotion]);
}

/** React Flow's colour mode, read from the BB theme actually on screen —
 *  left at its default, React Flow paints white chrome inside a dark host. */
export function useHostColorMode(): [React.RefObject<HTMLDivElement | null>, ColorMode] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [mode, setMode] = useState<ColorMode>("system");
  const measure = useCallback(() => {
    if (!ref.current || typeof getComputedStyle !== "function") return;
    // The shell itself is transparent, and `rgba(0, 0, 0, 0)` would read as
    // black: walk up to the first painted background, the one actually on
    // screen behind the canvas.
    for (let element: Element | null = ref.current; element; element = element.parentElement) {
      const lightness = colorLightness(getComputedStyle(element).backgroundColor);
      if (lightness === null) continue;
      setMode(lightness < 0.5 ? "dark" : "light");
      return;
    }
  }, []);
  useLayoutEffect(measure);
  // A theme switch repaints the host without re-rendering the canvas, so
  // measuring on render alone keeps the old mode until something else
  // happens to re-render it.
  useEffect(() => {
    if (typeof MutationObserver !== "function") return;
    const observer = new MutationObserver(measure);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });
    const media = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;
    media?.addEventListener("change", measure);
    return () => {
      observer.disconnect();
      media?.removeEventListener("change", measure);
    };
  }, [measure]);
  return [ref, mode];
}

/** Perceived lightness (0–1) of an `rgb()`/`rgba()` string, or `null` if it
 *  cannot be read or is fully transparent. */
export function colorLightness(color: string): number | null {
  const match = color.match(/rgba?\(([^)]+)\)/);
  if (!match) return null;
  const [r, g, b, alpha] = match[1]!.split(",").map((part) => Number(part.trim()));
  if (alpha === 0) return null;
  if (r === undefined || g === undefined || b === undefined || [r, g, b].some(Number.isNaN)) return null;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/** A tree grows left to right, so a node's one incoming edge arrives on its
 *  left and its outgoing edges leave from its right — without a handle on
 *  each side, React Flow has nowhere to anchor the path and draws no edge
 *  at all (its own connection points default to top/bottom). */
function CanvasNodeView({ data }: { data: NodeCardProps }) {
  return (
    <>
      <Handle type="target" position={Position.Left} style={{ visibility: "hidden" }} />
      <NodeCard {...data} />
      <Handle type="source" position={Position.Right} style={{ visibility: "hidden" }} />
    </>
  );
}

/** `width`/`height` arrive via the node's own `style`, not `data` — React
 *  Flow positions the wrapper, `Frame` just fills it. */
function CanvasFrameView({
  data,
  style,
}: {
  data: Pick<FrameProps, "label" | "dimmed">;
  style?: { width?: number; height?: number };
}) {
  return (
    <Frame
      label={data.label}
      dimmed={data.dimmed}
      x={0}
      y={0}
      width={style?.width ?? 0}
      height={style?.height ?? 0}
    />
  );
}

const NODE_TYPES = { canvasNode: CanvasNodeView, canvasFrame: CanvasFrameView };
const EDGE_TYPES = { statusEdge: StatusEdge };
const EMPTY_DIMMED: ReadonlySet<string> = new Set();
const FIT_VIEW_OPTIONS = { padding: 0.08 };
// React Flow's own floor (0.5) cuts off a real tree (two ten-member crews no
// longer fit); its ceiling (2) is left as is.
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 2;

/** `-deltaY` scaled the same way React Flow's own pinch handler reads a wheel
 *  event — pixel/line/page delta modes — but without its extra ×10 factor for
 *  Ctrl+wheel on macOS, which turns one mouse-wheel notch into a 4x zoom jump
 *  (BBP-197 Fix 3). One formula for both a mouse-wheel notch (deltaY ~100,
 *  a mild ~13% step) and a trackpad pinch (deltaY ~1–10, smooth). */
function wheelZoomDelta(event: { deltaY: number; deltaMode: number }): number {
  const modeFactor = event.deltaMode === 1 ? 0.05 : event.deltaMode === 2 ? 1 : 0.002;
  return -event.deltaY * modeFactor;
}

/** Lower bound for the first fit only (BBP-196): with 34 projects, fitting
 *  the whole tree shrank the cards below reading size. Manual zoom still goes
 *  down to 0.2, and "Collapse all"/`0` still fit the whole visible tree.
 *
 *  BBP-214 feedback 3 round 1 raised this to 0.75, reasoning that BBP-221's
 *  smaller tier sizes shrank the fitted bounding box — backwards: a smaller
 *  box needs *less* zoom-out to fit, so the floor should bind less often, not
 *  more (`getViewportForBounds` in `@xyflow/system` confirms the formula).
 *  Reverted to 0.6; the real cause was the start fit racing the host
 *  container's first real-size measurement (see the fit effect below). */
export const START_MIN_ZOOM = 0.6;

/** The first fit frames the roots and their direct children, never deeper
 *  levels, and never zooms out past `START_MIN_ZOOM`. A floor, not a fixed
 *  zoom: a small tree still fits as large as it would anyway. */
export function startFitOptions(nodes: readonly CanvasNode[]) {
  const ids = new Set(nodes.map((n) => n.id));
  const isRoot = (n: CanvasNode) => n.parentId === null || !ids.has(n.parentId);
  const rootIds = new Set(nodes.filter(isRoot).map((n) => n.id));
  const firstLevel = nodes.filter((n) => isRoot(n) || rootIds.has(n.parentId as string));
  return { ...FIT_VIEW_OPTIONS, nodes: firstLevel.map((n) => ({ id: n.id })), minZoom: START_MIN_ZOOM };
}

export type CanvasShellProps = {
  nodes: readonly CanvasNode[];
  expanded: ReadonlySet<string>;
  /** Cards that get a chevron (BBP-183); absent: none do. */
  expandable?: ReadonlySet<string>;
  onToggle?: (nodeId: string) => void;
  /** Bump to re-fit the view to the whole tree — after Collapse all /
   *  Expand all, whose new layout otherwise sits off screen (BBP-179). */
  fitRequest?: number;
  edges?: readonly CanvasEdge[];
  frames?: readonly CanvasFrame[];
  selectedId?: string | null;
  /** The node with the keyboard halo (BBP-290); none by default. */
  haloId?: string | null;
  /** The click's modifier keys ride along (BBP-241: Ctrl/Cmd-click toggles
   *  focus instead of selecting). */
  onSelect?: (nodeId: string, event?: ReactMouseEvent) => void;
  /** A click on the empty canvas (BBP-298: closes the detail panel). */
  onBackgroundClick?: () => void;
  /** Node and frame ids outside the frame being edited (BBP-166) — faded,
   *  locked, no `onSelect`. */
  dimmedIds?: ReadonlySet<string>;
  /** Nodes whose lazy load failed (BBP-179) — shown as a visible error on
   *  the card instead of an empty one, and retried on the next toggle. */
  failedLoads?: ReadonlySet<string>;
  className?: string;
};

/** What a caller outside the `ReactFlowProvider` can still do to the
 *  viewport — the `0`/`+`/`-` keys in particular, owned by `CanvasView`. */
export type CanvasShellHandle = {
  resetView: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  /** Pans to one node at the current zoom (BBP-290). */
  centerOn: (nodeId: string) => void;
};

/** React Flow edges for the placed ones; relations sit below every card and
 *  badge (BBP-202). */
export function toFlowEdges(placedEdges: readonly PlacedEdge[]): Edge[] {
  return placedEdges.map((placed, index) => ({
    id: `${placed.from}->${placed.to}-${index}`,
    source: placed.from,
    target: placed.to,
    type: "statusEdge",
    data: {
      variant: placed.variant,
      path: placed.path,
      label: placed.label,
      state: placed.state,
      relation: placed.relation,
      emphasis: placed.emphasis,
    } satisfies StatusEdgeData as unknown as Record<string, unknown>,
    ...(placed.relation ? { zIndex: 0 } : {}),
  }));
}

function toFlow(
  layout: TreeLayout,
  nodes: readonly CanvasNode[],
  frames: readonly CanvasFrame[],
  selectedId: string | null | undefined,
  onSelect: ((id: string, event?: ReactMouseEvent) => void) | undefined,
  dimmedIds: ReadonlySet<string>,
  expanded: ReadonlySet<string>,
  expandable: ReadonlySet<string>,
  onToggle: ((id: string) => void) | undefined,
  failedLoads: ReadonlySet<string>,
  haloId: string | null = null,
): { flowNodes: Node[]; flowEdges: Edge[] } {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const byFrameId = new Map(frames.map((frame) => [frame.id, frame]));
  const childCount = new Map<string, number>();
  for (const node of nodes) {
    if (node.parentId !== null) childCount.set(node.parentId, (childCount.get(node.parentId) ?? 0) + 1);
  }
  const flowNodes: Node[] = layout.positions.map((placed) => {
    const node = byId.get(placed.id)!;
    const data: NodeCardProps = {
      label: node.label,
      subtitle: describeNode(node.kind, childCount.get(node.id) ?? 0, node.meta),
      icon: <KindIcon kind={node.kind} />,
      status: node.status,
      kind: node.kind,
      selected: node.id === selectedId,
      halo: node.id === haloId,
      onClick: onSelect ? (event: ReactMouseEvent<HTMLButtonElement>) => onSelect(node.id, event) : undefined,
      dimmed: dimmedIds.has(node.id),
      loadFailed: failedLoads.has(node.id),
      expander: expandable.has(node.id)
        ? {
            expanded: expanded.has(node.id),
            childCount: childCount.get(node.id) ?? 0,
            onToggle: () => onToggle?.(node.id),
          }
        : undefined,
    };
    return {
      id: placed.id,
      type: "canvasNode",
      position: { x: placed.x, y: placed.y },
      // Both the style (what paints) and `width`/`height` (what React Flow
      // treats as already measured): without the latter a node stays
      // `visibility: hidden` until its own ResizeObserver fires, which never
      // happens in a DOM that only stubs the observer.
      style: { width: placed.width, height: placed.height },
      width: placed.width,
      height: placed.height,
      data: data as unknown as Record<string, unknown>,
      draggable: false,
      selectable: false,
    };
  });

  const flowEdges = toFlowEdges(layout.edges);

  const frameNodes: Node[] = (layout.frames ?? []).map((placed) => ({
    id: placed.id,
    type: "canvasFrame",
    position: { x: placed.x, y: placed.y },
    style: { width: placed.width, height: placed.height },
    width: placed.width,
    height: placed.height,
    data: {
      label: byFrameId.get(placed.id)?.label,
      dimmed: dimmedIds.has(placed.id),
    } as unknown as Record<string, unknown>,
    draggable: false,
    selectable: false,
    // Below every card: React Flow stacks nodes in array order by default.
    zIndex: 0,
  }));

  return { flowNodes: [...frameNodes, ...flowNodes], flowEdges };
}

const CanvasShellInner = forwardRef<CanvasShellHandle, CanvasShellProps>(function CanvasShellInner(
  {
    nodes,
    expanded,
    expandable = EMPTY_DIMMED,
    onToggle,
    fitRequest = 0,
    edges = [],
    frames = [],
    selectedId,
    haloId = null,
    onSelect,
    onBackgroundClick,
    dimmedIds = EMPTY_DIMMED,
    failedLoads = EMPTY_DIMMED,
    className,
  },
  handleRef,
) {
  const [hostRef, themeMode] = useHostColorMode();
  const flow = useReactFlow();
  const layout = useMemo(
    () => layoutTree(nodes, expanded, edges, frames, selectedId),
    [nodes, expanded, edges, frames, selectedId],
  );
  const { flowNodes, flowEdges } = useMemo(
    () =>
      toFlow(layout, nodes, frames, selectedId, onSelect, dimmedIds, expanded, expandable, onToggle, failedLoads, haloId),
    [layout, nodes, frames, selectedId, onSelect, dimmedIds, expanded, expandable, onToggle, failedLoads, haloId],
  );

  const reducedMotion = usePrefersReducedMotion();
  const animatedNodes = useNodeMotion(flowNodes, reducedMotion);

  const startFit = useMemo(() => startFitOptions(nodes), [nodes]);
  // Once the user has taken the viewport into their own hands — panned,
  // zoomed, or asked for an explicit fit — the start fit must stop chasing
  // the tree; from then on a layout change should leave the view alone.
  const userInteracted = useRef(false);

  // BBP-196: with a restored project filter and restored expanded threads/
  // turns, their children arrive over several async `loadChildren` calls
  // after mount, each one growing and re-centering the tree (`layoutTree`
  // centers a parent on its children). React Flow's own `fitView` prop only
  // fits once, against whichever node set was first in its store — stale the
  // moment more nodes land, so the camera is left looking at empty space.
  // Re-fitting to `startFit` on every `nodes` change — not just the first —
  // keeps the start view matching the tree as it grows, until the user
  // interacts.
  //
  // BBP-214 feedback 3 (round 2): React Flow measures its own container via
  // `domNode.offsetWidth/offsetHeight` on mount and falls back to a 500x500
  // guess whenever that reads as 0 (`useResizeHandler` in `@xyflow/react`),
  // with no re-measure until the next resize event. If our host panel is
  // still 0-sized the instant this mounts — plausible right after a reload,
  // before BB's own layout has settled — `fitView` bakes a zoom/pan meant
  // for a 500x500 box into the viewport, and it never corrects itself: a
  // later resize updates React Flow's stored dimensions, but nothing calls
  // `fitView` again just because of that. Gate the fit on our *own* host
  // element reporting a real size first, polling a frame at a time, so we
  // never fit against a guess.
  useEffect(() => {
    if (userInteracted.current) return;
    let frame = 0;
    const tryFit = () => {
      const host = hostRef.current;
      if (!host || host.clientWidth === 0 || host.clientHeight === 0) {
        frame = requestAnimationFrame(tryFit);
        return;
      }
      // A frame later still: React Flow takes the new nodes into its store
      // in its own effect, and fitting before that fits the old tree.
      frame = requestAnimationFrame(() => void flow.fitView(startFit));
    };
    frame = requestAnimationFrame(tryFit);
    return () => cancelAnimationFrame(frame);
  }, [startFit, flow, hostRef]);

  useEffect(() => {
    if (fitRequest === 0) return;
    userInteracted.current = true;
    // A frame later: React Flow takes the new nodes into its store in its
    // own effect, and fitting before that fits the old tree.
    const frame = requestAnimationFrame(() => void flow.fitView(FIT_VIEW_OPTIONS));
    return () => cancelAnimationFrame(frame);
  }, [fitRequest, flow]);

  useImperativeHandle(
    handleRef,
    () => ({
      resetView: () => {
        userInteracted.current = true;
        flow.fitView();
      },
      zoomIn: () => {
        userInteracted.current = true;
        flow.zoomIn();
      },
      zoomOut: () => {
        userInteracted.current = true;
        flow.zoomOut();
      },
      centerOn: (nodeId) => {
        userInteracted.current = true;
        // A frame later: a jump can expand nothing, but the layout may still
        // be settling from the selection's own re-layout.
        requestAnimationFrame(() => void flow.fitView({ nodes: [{ id: nodeId }], maxZoom: flow.getZoom(), minZoom: flow.getZoom(), duration: 200 }));
      },
    }),
    [flow],
  );

  // Own Ctrl/Cmd+wheel zoom, at the pointer (BBP-197 Fix 3): React Flow's
  // built-in pinch-on-wheel path only recognises Ctrl (not Cmd/Meta), and
  // only on macOS multiplies the step by 10 for Ctrl, not for Cmd — neither
  // of which this canvas wants. Captured above the pane, so it runs (and can
  // stop the event) before React Flow's own wheel listener sees it; a plain
  // wheel/trackpad-pan gesture (no Ctrl/Cmd) is untouched and still pans.
  const onWheelCapture = useCallback(
    (event: ReactWheelEvent<HTMLDivElement>) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      event.stopPropagation();
      // Programmatic (`flow.setViewport` below, not a gesture React Flow's
      // own `onMoveStart` sees) — mark it by hand, or the BBP-196 start-fit
      // effect would refit the view away from this zoom on the next change.
      userInteracted.current = true;
      const bounds = event.currentTarget.getBoundingClientRect();
      const pointer = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
      const before = flow.getViewport();
      const factor = Math.pow(2, wheelZoomDelta(event));
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, before.zoom * factor));
      // The flow-space point under the pointer stays fixed: solve for the
      // new viewport offset that keeps it under the same screen pixel.
      const flowPoint = { x: (pointer.x - before.x) / before.zoom, y: (pointer.y - before.y) / before.zoom };
      flow.setViewport({ x: pointer.x - flowPoint.x * zoom, y: pointer.y - flowPoint.y * zoom, zoom });
    },
    [flow],
  );

  return (
    <div
      ref={hostRef}
      className={className}
      style={{ width: "100%", height: "100%" }}
      onWheelCapture={onWheelCapture}
    >
      <style>{MOTION_CSS}</style>
      <ReactFlow
        nodes={animatedNodes}
        edges={flowEdges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        colorMode={themeMode}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        // React Flow's own keyboard a11y moves a focused node with the
        // arrow keys and deletes it with Delete — exactly the keys
        // `CanvasView` already gives a meaning to. Without this, a click on a
        // card (which focuses its node) hands those keys to React Flow first.
        disableKeyboardA11y
        zoomOnScroll={false}
        panOnScroll
        zoomOnPinch
        // Ctrl/Cmd+wheel zoom is handled above (`onWheelCapture`) instead.
        zoomActivationKeyCode={null}
        // No `fitView` prop: it only fits once, against whichever nodes are
        // first in React Flow's store. The effect above re-fits explicitly,
        // on every nodes change, until the user takes over.
        onMoveStart={(event) => {
          // `event` is null for a programmatic move (our own `fitView`
          // calls) and set for an actual user gesture (drag, wheel, pinch).
          if (event) userInteracted.current = true;
        }}
        onPaneClick={onBackgroundClick}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        // The canvas is a page of its own inside BB, not a demo; the corner
        // badge would be the only non-BB text on it.
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
});

export const CanvasShell = forwardRef<CanvasShellHandle, CanvasShellProps>(function CanvasShell(props, ref) {
  // Its own provider: two shells on one page (a preview and the full canvas)
  // must not share a viewport.
  return (
    <ReactFlowProvider>
      <CanvasShellInner {...props} ref={ref} />
    </ReactFlowProvider>
  );
});
