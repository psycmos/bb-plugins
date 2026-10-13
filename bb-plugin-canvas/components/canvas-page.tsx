// The Canvas nav page (BBP-189): every thread BB lists, chat threads
// included, under Agents → its project. Reads the SDK directly — no crew or
// Graph Studio RPC — so it works with neither installed. A thread's turns
// load only when it is opened (the newest `turnsPerThread` of them);
// `thread:changed` keeps status and loaded turns current. The same page is
// the thread panel's "Canvas" tab, focused on that thread (BBP-277).
import { useEffect, useMemo, useRef, useState } from "react";
import { useBbNavigate, useSdk, useSettings } from "@get-bb/plugin-sdk/app";
import { CanvasView } from "../vendor/bb-canvas/components/CanvasView";
import { FocusUnavailable } from "../vendor/bb-canvas/components/FocusUnavailable";
import { Legend } from "../vendor/bb-canvas/components/Legend";
import type { ColorMode } from "../vendor/bb-canvas/lib/kind-colors";
import { missingFocusIds, visibleFocusIds } from "../vendor/bb-canvas/lib/focus-filter";
import { overviewSettings, overviewTree, type OverviewSettings } from "../vendor/bb-canvas/lib/overview";
import type { ProjectLike, ThreadListItem } from "../vendor/bb-canvas/lib/thread-tree";
import { DEFAULT_THREAD_FILTER, limitTurns, type ThreadFilter } from "../vendor/bb-canvas/lib/thread-filter";
import {
  enrichTurnNodes,
  threadNodeId,
  timelineToCanvas,
  turnDetailsToCanvas,
  type TimelineRowLike,
  type TurnFirstLinePort,
} from "../vendor/bb-canvas/lib/canvas-threads";
import type { CanvasEdge, CanvasNode } from "../vendor/bb-canvas/lib/types";
import { ActivitySection } from "./activity-section";

type State = { projects: ProjectLike[]; threads: readonly ThreadListItem[] } | { error: string } | null;
type Sdk = ReturnType<typeof useSdk>;

async function turnDetails(sdk: Sdk, threadId: string, turnId: string, sourceSeqStart: number, sourceSeqEnd: number) {
  const response = await sdk.threads.timelineTurnSummaryDetails({
    threadId,
    turnId,
    sourceSeqStart: String(sourceSeqStart),
    sourceSeqEnd: String(sourceSeqEnd),
  });
  return { rows: response.rows as unknown as readonly TimelineRowLike[] };
}

function turnFirstLinePort(sdk: Sdk): TurnFirstLinePort {
  return { turnDetails: (turnId, threadId, start, end) => turnDetails(sdk, threadId, turnId, start, end) };
}

/** Keeps only the newest `limit` turn nodes, plus the `pinned` ones (and the
 *  edges among what is left). */
function limitTurnNodes<R extends { nodes: CanvasNode[]; edges?: CanvasEdge[] }>(
  result: R,
  limit: number | null,
  pinned: ReadonlySet<string> = new Set(),
): R {
  const kept = new Set(limitTurns(result.nodes.filter((node) => node.kind === "turn"), limit).map((node) => node.id));
  for (const id of pinned) kept.add(id);
  const nodes = result.nodes.filter((node) => node.kind !== "turn" || kept.has(node.id));
  const ids = new Set(nodes.map((node) => node.id));
  const edges = result.edges?.filter((edge) => ids.has(edge.from) && ids.has(edge.to));
  return { ...result, nodes, ...(edges ? { edges } : {}) };
}

/** A turn shows its newest this many steps; older ones sit behind "+N earlier". */
const STEPS_PER_TURN = 10;

/** `pinned`: turn node ids the Activity list brought into view past the limit. */
export async function loadChildren(
  sdk: Sdk,
  node: CanvasNode,
  turnsPerThread: number | null = DEFAULT_THREAD_FILTER.turnsPerThread,
  pinned: ReadonlySet<string> = new Set(),
) {
  const { threadId, turnId, sourceSeqStart, sourceSeqEnd } = node.meta ?? {};
  if (typeof threadId !== "string") return { nodes: [] };
  if (node.kind === "thread") {
    const response = await sdk.threads.timeline({ threadId });
    const result = limitTurnNodes(timelineToCanvas(threadId, { rows: response.rows as unknown as readonly TimelineRowLike[] }), turnsPerThread, pinned);
    return { ...result, nodes: await enrichTurnNodes(result.nodes, turnFirstLinePort(sdk)) };
  }
  if (node.kind === "turn" && typeof turnId === "string" && typeof sourceSeqStart === "number" && typeof sourceSeqEnd === "number") {
    return turnDetailsToCanvas(node.id, await turnDetails(sdk, threadId, turnId, sourceSeqStart, sourceSeqEnd), threadId, STEPS_PER_TURN);
  }
  return { nodes: [] };
}

/** The runtime status a `thread:changed` event carries, if any. */
function eventStatus(event: { metadata?: unknown }): string | null {
  const status = (event.metadata as { statusChange?: { runtime?: { displayStatus?: unknown } } } | undefined)?.statusChange?.runtime?.displayStatus;
  return typeof status === "string" ? status : null;
}

/** The nav page's deep link `thread/<id>`, the thread panel's own thread otherwise. */
function focusFromSubPath(subPath: string | undefined): string | null {
  const match = /^thread\/([^/]+)$/.exec(subPath ?? "");
  return match ? decodeURIComponent(match[1]!) : null;
}

/**
 * `overview` overrides the window and limit from the plugin settings;
 * `activeOnly` is the toggle's default until the user flips it (then stored).
 * The page is the graph alone, as in agent-graph (BBP-298): window, limit and
 * turns per thread live in the plugin settings, not on the surface, and a
 * thread's chat opens in BB's own thread view on double-click.
 */
export type CanvasPageProps = {
  subPath?: string;
  focusThreadId?: string;
  overview?: Partial<OverviewSettings>;
  activeOnly?: boolean;
};

const ACTIVE_ONLY_KEY = "bb-canvas:active-only";
const COLOR_BY_KEY = "bb-canvas:color-by";

function loadColorBy(): ColorMode {
  try {
    return localStorage.getItem(COLOR_BY_KEY) === "status" ? "status" : "type";
  } catch {
    return "type";
  }
}

function saveColorBy(value: ColorMode) {
  try {
    localStorage.setItem(COLOR_BY_KEY, value);
  } catch {
    // Storage blocked: the toggle still works for this page.
  }
}

const TOOLBAR_BUTTON =
  "rounded-md border px-2 py-0.5 text-[11px] transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary";

function loadActiveOnly(): boolean | null {
  try {
    const raw = localStorage.getItem(ACTIVE_ONLY_KEY);
    return raw === null ? null : raw === "true";
  } catch {
    return null;
  }
}

function saveActiveOnly(value: boolean) {
  try {
    localStorage.setItem(ACTIVE_ONLY_KEY, String(value));
  } catch {
    // Storage blocked: the toggle still works for this page.
  }
}

export function CanvasPage({ subPath, focusThreadId, overview, activeOnly: activeOnlyDefault = false }: CanvasPageProps) {
  const sdk = useSdk();
  const navigate = useBbNavigate();
  const [state, setState] = useState<State>(null);
  const [focus, setFocus] = useState<string | null>(() => focusThreadId ?? focusFromSubPath(subPath));
  // The overview window comes from the plugin settings (BBP-287), which may
  // arrive after the first render.
  const settings = useSettings().values;
  const defaults = useMemo<ThreadFilter>(
    () => ({ ...DEFAULT_THREAD_FILTER, ...overviewSettings(settings), ...overview }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(settings), JSON.stringify(overview)],
  );
  const filter: ThreadFilter = defaults;
  const [activeOnly, setActiveOnlyState] = useState(() => loadActiveOnly() ?? activeOnlyDefault);
  const setActiveOnly = (value: boolean) => {
    saveActiveOnly(value);
    setActiveOnlyState(value);
  };
  const [colorBy, setColorByState] = useState<ColorMode>(loadColorBy);
  const setColorBy = (value: ColorMode) => {
    saveColorBy(value);
    setColorByState(value);
  };
  const viewRef = useRef<HTMLDivElement | null>(null);
  const turnsPerThread = useRef(filter.turnsPerThread);
  turnsPerThread.current = filter.turnsPerThread;
  // Per thread node: bumped on every `thread:changed`; CanvasView reloads
  // only the threads whose turns are already loaded.
  const [reloads, setReloads] = useState<ReadonlyMap<string, number>>(new Map());
  const reloadThread = (id: string) => setReloads((prev) => new Map(prev).set(id, (prev.get(id) ?? 0) + 1));
  // Turns the Activity list brought into view past the turn limit (BBP-291).
  const pinned = useRef(new Set<string>());
  const [reveal, setReveal] = useState<{ id: string; seq: number } | null>(null);
  const revealEntry = (threadId: string, nodeId: string, inCanvas: boolean) => {
    if (!inCanvas && !pinned.current.has(nodeId)) {
      pinned.current.add(nodeId);
      reloadThread(threadNodeId(threadId));
    }
    setReveal((prev) => ({ id: nodeId, seq: (prev?.seq ?? 0) + 1 }));
  };

  useEffect(() => {
    let cancelled = false;
    // An unreadable project list only costs the project names: the tree then
    // names each project by its id.
    const projects = sdk.projects.list().then(
      (list) => list.map((project): ProjectLike => ({ id: project.id, name: project.name ?? project.id })),
      () => [] as ProjectLike[],
    );
    Promise.all([projects, sdk.threads.list()]).then(
      ([projectList, threads]) => {
        if (!cancelled) setState({ projects: projectList, threads: threads as unknown as readonly ThreadListItem[] });
      },
      (cause: unknown) => {
        if (!cancelled) setState({ error: cause instanceof Error ? cause.message : String(cause) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [sdk]);

  const layer = useMemo(() => {
    if (state === null || !("threads" in state)) return null;
    return overviewTree({ projects: state.projects, threads: state.threads, filter, focusThreadId: focus, now: Date.now(), activeOnly });
  }, [state, filter, focus, activeOnly]);
  const focusIds = useMemo(() => (focus === null ? [] : [threadNodeId(focus)]), [focus]);

  useEffect(
    () =>
      sdk.subscribe({
        event: "thread:changed",
        callback: (event) => {
          const threadId = event.id;
          if (!threadId) return;
          const status = eventStatus(event);
          if (status)
            setState((prev) =>
              prev && "threads" in prev
                ? { ...prev, threads: prev.threads.map((thread) => (thread.id === threadId ? { ...thread, status } : thread)) }
                : prev,
            );
          const id = threadNodeId(threadId);
          reloadThread(id);
        },
      }),
    [sdk],
  );

  if (state === null) return <div className="p-4 text-sm text-muted-foreground">Loading…</div>;
  if ("error" in state) return <div className="p-4 text-sm text-destructive">Canvas not available: {state.error}</div>;
  // Before the empty states: a focus on a thread that is gone is the answer
  // the user needs, whether or not anything else is left to show.
  if (layer !== null && focusIds.length > 0 && missingFocusIds(layer.nodes, focusIds).length === focusIds.length)
    return <FocusUnavailable onShowAll={() => setFocus(null)} />;
  if (state.threads.length === 0) return <div className="p-4 text-sm text-muted-foreground">No threads yet.</div>;
  const toolbar = (
    <>
      <button
        type="button"
        aria-pressed={activeOnly}
        onClick={() => setActiveOnly(!activeOnly)}
        className={`${TOOLBAR_BUTTON} ${activeOnly ? "border-primary bg-primary/10 text-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground"}`}
      >
        Active only
      </button>
      <button
        type="button"
        onClick={() => setColorBy(colorBy === "type" ? "status" : "type")}
        className={`${TOOLBAR_BUTTON} border-border bg-card text-muted-foreground hover:text-foreground`}
      >
        Color: {colorBy === "type" ? "Type" : "Status"}
      </button>
    </>
  );
  if (activeOnly && (layer === null || layer.nodes.length === 0))
    return (
      <div className="flex flex-col">
        <div className="flex flex-wrap items-center gap-1.5 px-2 py-1">{toolbar}</div>
        <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
          Nothing is running right now.
          <button
            type="button"
            onClick={() => setActiveOnly(false)}
            className="rounded px-1 text-primary underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary"
          >
            Show everything
          </button>
        </div>
      </div>
    );
  if (layer === null || layer.nodes.length === 0)
    return (
      <div className="flex flex-col">
        <div className="flex flex-wrap items-center gap-1.5 px-2 py-1">{toolbar}</div>
        <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
          No threads in the overview window. Widen it in the plugin settings.
          <button
            type="button"
            onClick={() => setActiveOnly(false)}
            className="rounded px-1 text-primary underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary"
          >
            Show everything
          </button>
        </div>
      </div>
    );
  const visible = visibleFocusIds(layer.nodes, focusIds);
  const running = layer.nodes.filter((node) => node.status === "running").length;
  // "Running N" does what J does: the canvas cycles through running work.
  const jumpToRunning = () => viewRef.current?.querySelector<HTMLElement>("[data-canvas-view]")?.dispatchEvent(new KeyboardEvent("keydown", { key: "j", bubbles: true }));
  return (
    <div ref={viewRef} className="flex h-full min-h-0 flex-col">
        <CanvasView
          nodes={layer.nodes.filter((node) => visible.has(node.id))}
          edges={layer.edges}
          initialExpanded={new Set(layer.expanded)}
          toolbar={toolbar}
          halo
          colorBy={colorBy}
          controlsPosition="bottom-right"
          overlay={(shown) => <Legend nodes={shown} colorBy={colorBy} />}
          cornerAction={
            running > 0 ? (
              <button
                type="button"
                onClick={jumpToRunning}
                className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-[11px] text-foreground shadow-sm hover:bg-muted"
              >
                <span aria-hidden className="h-2 w-2 rounded-full bg-primary" />
                Running {running}
              </button>
            ) : null
          }
          surface="canvas"
          focusSelected={focusIds}
          // A thread always has turns to fetch; a turn only if it has steps.
          canLoadChildren={(node) =>
            (node.kind === "thread" && typeof node.meta?.threadId === "string") ||
            (node.kind === "turn" && typeof node.meta?.summaryCount === "number" && node.meta.summaryCount > 0)
          }
          loadChildren={(node) => loadChildren(sdk, node, turnsPerThread.current, pinned.current)}
          reveal={reveal}
          renderSidebarExtra={(node) => {
            const threadId = node.kind === "thread" ? node.meta?.threadId : undefined;
            if (typeof threadId !== "string") return null;
            return (
              <ActivitySection
                sdk={sdk}
                threadId={threadId}
                turnsPerThread={filter.turnsPerThread}
                version={reloads.get(node.id) ?? 0}
                onReveal={(nodeId, inCanvas) => revealEntry(threadId, nodeId, inCanvas)}
              />
            );
          }}
          reloadChildren={reloads}
          onOpenThread={(threadId) => navigate.toThread(threadId)}
          className="h-full"
        />
    </div>
  );
}
