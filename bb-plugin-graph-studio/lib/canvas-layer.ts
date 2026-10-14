// Graph Studio's part of the shared canvas (BBP-131): runs, their steps and
// loops as bb-canvas nodes. Pure, so the mapping is testable without a store.
//
// A run hangs under the crew member whose thread started it (the member node
// ids come from crew's own `canvasLayer`), otherwise under the project. Per
// parent, the newest run and every run still in progress stay visible; older
// finished runs fold into one "+N runs" card. Runs start collapsed — a mini
// card that opens into its steps.
import { EMPTY_LAYER, mergeLayers, projectNodeId, withRoots, type CanvasLayer } from "../vendor/bb-canvas/lib/layer";
import type { CanvasEdge, CanvasNode, CanvasStatus } from "../vendor/bb-canvas/lib/types";
import { formatTimestamp } from "../vendor/bb-canvas/lib/format";
import { END_NODE, START_NODE, type Graph } from "./graph";
import { now } from "./edge-state";
import { layoutGraph } from "./layout";

type RunStatus = "running" | "stopping" | "waiting-human" | "done" | "failed" | "stopped";
type StepStatus = "running" | "done" | "failed" | "skipped";

/** The slice of `RunDto` the canvas needs. */
export type CanvasRun = {
  id: string;
  graph: Graph;
  status: RunStatus;
  threadId: string | null;
  createdAt: number;
  nodeRuns: { nodeId: string; attempt: number; status: StepStatus; childThreadId?: string | null }[];
  /** The question the run waits on (a human node), if it waits. */
  pendingQuestion?: { nodeId: string; label: string; question: string } | null;
};

const RUN_STATUS: Record<RunStatus, CanvasStatus> = {
  running: "running",
  stopping: "running",
  "waiting-human": "waiting",
  done: "done",
  failed: "failed",
  stopped: "idle",
};

const STEP_STATUS: Record<StepStatus, CanvasStatus> = {
  running: "running",
  done: "done",
  failed: "failed",
  skipped: "idle",
};

const inProgress = (run: CanvasRun) => run.status === "running" || run.status === "stopping" || run.status === "waiting-human";

export const runNodeId = (runId: string): string => `graph-run:${runId}`;
const stepNodeId = (runId: string, nodeId: string): string => `step:${runId}:${nodeId}`;

/** `memberByThread`: thread id → member node id, from crew's layer. */
export function graphCanvasLayer(
  projectId: string,
  runs: CanvasRun[],
  memberByThread: ReadonlyMap<string, string>,
  steps: (layer: CanvasLayer, run: CanvasRun, runId: string) => void = treeSteps,
): CanvasLayer {
  const layer: CanvasLayer = { nodes: [], edges: [], expanded: [] };
  const parentOf = (run: CanvasRun) =>
    (run.threadId !== null ? memberByThread.get(run.threadId) : undefined) ?? projectNodeId(projectId);

  const byParent = new Map<string, CanvasRun[]>();
  for (const run of runs) {
    const parent = parentOf(run);
    byParent.set(parent, [...(byParent.get(parent) ?? []), run]);
  }

  for (const [parent, group] of byParent) {
    const sorted = [...group].sort((a, b) => b.createdAt - a.createdAt);
    const shown = sorted.filter((run, index) => index === 0 || inProgress(run));
    const folded = sorted.filter((run) => !shown.includes(run));
    for (const run of shown) addRun(layer, run, parent, steps);
    if (folded.length > 0) {
      const more = `more-runs:${parent}`;
      layer.nodes.push({
        id: more,
        kind: "graph-run",
        label: `+${folded.length} runs`,
        parentId: parent,
        meta: { placeholder: true, runIds: folded.map((run) => run.id) },
      });
      for (const run of folded) addRun(layer, run, more, steps);
    }
  }
  return layer;
}

function addRun(layer: CanvasLayer, run: CanvasRun, parentId: string, steps: (layer: CanvasLayer, run: CanvasRun, runId: string) => void): void {
  const id = runNodeId(run.id);
  const latest = new Map<string, { attempt: number; status: StepStatus }>();
  for (const step of run.nodeRuns) {
    const seen = latest.get(step.nodeId);
    if (!seen || step.attempt >= seen.attempt) latest.set(step.nodeId, step);
  }
  const done = run.graph.nodes.filter((node) => latest.get(node.id)?.status === "done").length;
  // BBP-303: one segment per step for the card's progress strip, and the
  // question the run waits on — the canvas draws "Needs you" from it.
  const waitingOn = run.status === "waiting-human" ? (run.pendingQuestion ?? null) : null;
  const progress = run.graph.nodes.map((node) =>
    waitingOn?.nodeId === node.id ? "waiting" : (STEP_STATUS[latest.get(node.id)?.status as StepStatus] ?? "todo"),
  );
  const started = formatTimestamp(run.createdAt);
  layer.nodes.push({
    id,
    kind: "graph-run",
    label: run.graph.name,
    status: RUN_STATUS[run.status],
    parentId,
    meta: {
      runId: run.id,
      graphId: run.graph.id,
      status: run.status,
      threadId: run.threadId,
      ...(started ? { started } : {}),
      steps: `${done}/${run.graph.nodes.length}`,
      progress,
      ...(waitingOn ? { needsYou: { kind: "graph-studio", runId: run.id, nodeId: waitingOn.nodeId, label: waitingOn.label, question: waitingOn.question } } : {}),
    },
  });

  if (steps === flowSteps) layer.nodes[layer.nodes.length - 1]!.meta!.flow = true;
  steps(layer, run, id);
}

function latestOf(run: CanvasRun) {
  const latest = new Map<string, { attempt: number; status: StepStatus; childThreadId?: string | null }>();
  for (const step of run.nodeRuns) {
    const seen = latest.get(step.nodeId);
    if (!seen || step.attempt >= seen.attempt) latest.set(step.nodeId, step);
  }
  return latest;
}

/** The Activity Canvas's steps: one row per graph node under the run. */
function treeSteps(layer: CanvasLayer, run: CanvasRun, id: string): void {
  const latest = latestOf(run);
  for (const node of run.graph.nodes) {
    const last = latest.get(node.id);
    const step: CanvasNode = {
      id: stepNodeId(run.id, node.id),
      kind: "step",
      label: node.label,
      ...(last ? { status: STEP_STATUS[last.status] } : {}),
      parentId: id,
      meta: { nodeId: node.id, attempts: last?.attempt ?? 0 },
    };
    layer.nodes.push(step);
  }

  // Only loops are declared: the tree already draws run → step, and forward
  // edges between steps are graph-studio's own detail view.
  // A finished loop stays neutral (BBP-214 stage 1: "taken" removed) — only
  // one currently running its second attempt lights up as "now".
  const pseudo = new Set([START_NODE, END_NODE]);
  const nowKeys = now(run);
  for (const edge of layoutGraph(run.graph).edges) {
    if (!edge.isBack || pseudo.has(edge.from) || pseudo.has(edge.to)) continue;
    const back: CanvasEdge = { from: stepNodeId(run.id, edge.from), to: stepNodeId(run.id, edge.to), variant: "back" };
    if (edge.label) back.label = edge.label;
    if (nowKeys.has(edge.key)) back.state = "now";
    layer.edges.push(back);
  }
}

/**
 * BBP-303: the standalone Canvas's steps. A step that ran is the thread it ran
 * in (`thread:<id>`, so the Canvas draws and opens it like any thread); one
 * not reached yet is an empty outline; a human gate is a small step that
 * waits for you. Each carries its layer and lane from the graph's own
 * layout, and the graph's edges join them left to right.
 */
export function flowSteps(layer: CanvasLayer, run: CanvasRun, runId: string): void {
  const latest = latestOf(run);
  const layout = layoutGraph(run.graph);
  const pseudo = new Set([START_NODE, END_NODE]);
  const placedReal = layout.nodes.filter((node) => !pseudo.has(node.id));
  const minLayer = Math.min(...placedReal.map((node) => node.layer), Number.POSITIVE_INFINITY);
  const laneOf = new Map<string, number>();
  const byLayer = new Map<number, typeof placedReal>();
  for (const node of placedReal) byLayer.set(node.layer, [...(byLayer.get(node.layer) ?? []), node]);
  for (const list of byLayer.values()) [...list].sort((a, b) => a.x - b.x).forEach((node, index) => laneOf.set(node.id, index));
  const layerOf = new Map(placedReal.map((node) => [node.id, node.layer - minLayer]));
  const waitingOn = run.status === "waiting-human" ? (run.pendingQuestion ?? null) : null;
  const idOf = new Map<string, string>();
  for (const node of run.graph.nodes) {
    const last = latest.get(node.id);
    const threadId = last?.childThreadId ?? null;
    const id = threadId ? `thread:${threadId}` : stepNodeId(run.id, node.id);
    idOf.set(node.id, id);
    const attempts = run.nodeRuns.filter((step) => step.nodeId === node.id);
    const gate = node.kind === "human";
    const waits = waitingOn?.nodeId === node.id;
    layer.nodes.push({
      id,
      kind: gate ? "step" : "thread",
      label: node.label,
      ...(waits ? { status: "waiting" as const } : last ? { status: STEP_STATUS[last.status] } : {}),
      parentId: runId,
      meta: {
        step: true,
        nodeId: node.id,
        layer: layerOf.get(node.id) ?? 0,
        lane: laneOf.get(node.id) ?? 0,
        attempts: attempts.length,
        ...(threadId ? { threadId } : {}),
        attemptThreads: attempts.flatMap((step) => (step.childThreadId ? [step.childThreadId] : [])),
        ...(gate ? { gate: true } : {}),
        ...(!last && !gate ? { ghost: true } : {}),
        ...(waits ? { waitsForYou: { runId: run.id, nodeId: node.id, label: waitingOn!.label, question: waitingOn!.question } } : {}),
      },
    });
  }
  for (const edge of layout.edges) {
    if (pseudo.has(edge.from) || pseudo.has(edge.to)) continue;
    const from = idOf.get(edge.from);
    const to = idOf.get(edge.to);
    if (!from || !to) continue;
    const step: CanvasEdge = { from, to, variant: edge.isBack ? "back" : "step" };
    if (edge.label) step.label = edge.label;
    layer.edges.push(step);
  }
}

/**
 * The whole page tree: agents → project → crew's layer, with the runs hung
 * into it. Crew is optional — when `crewLayer` fails (not installed, disabled,
 * crashed) the page still renders, just without the crew level; `crew` says
 * which case the page is in.
 */
export async function canvasPageLayer(args: {
  projectId: string;
  projectLabel: string;
  runs: CanvasRun[];
  crewLayer: () => Promise<CanvasLayer>;
}): Promise<CanvasLayer & { crew: boolean }> {
  let crew: CanvasLayer = EMPTY_LAYER;
  let available = true;
  try {
    crew = await args.crewLayer();
  } catch {
    available = false;
  }
  const memberByThread = new Map<string, string>();
  for (const node of crew.nodes) {
    const threadId = node.kind === "member" ? node.meta?.threadId : undefined;
    if (typeof threadId === "string") memberByThread.set(threadId, node.id);
  }
  const page = withRoots(args.projectId, args.projectLabel, mergeLayers(crew, graphCanvasLayer(args.projectId, args.runs, memberByThread)));
  return { ...page, crew: available };
}

/**
 * BBP-191: this plugin's layer for the standalone Canvas plugin. Only the
 * runs — the Canvas asks crew itself. A run hangs under the thread it was
 * started from (the Canvas's `thread:<id>` node, which is also how it draws
 * a crew member); `meta.fallbackParentId` names the project for a run whose
 * thread the Canvas does not show.
 */
export function canvasExtensionLayer(projectId: string, runs: CanvasRun[]): CanvasLayer & { frames: [] } {
  const byThread = new Map(runs.flatMap((run) => (run.threadId !== null ? [[run.threadId, `thread:${run.threadId}`] as const] : [])));
  const layer = graphCanvasLayer(projectId, runs, byThread, flowSteps);
  const project = projectNodeId(projectId);
  return {
    ...layer,
    nodes: layer.nodes.map((node) => (node.kind === "graph-run" && node.parentId !== project ? { ...node, meta: { ...node.meta, fallbackParentId: project } } : node)),
    frames: [],
  };
}
