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
        ...(waits ? { waitsForYou: { kind: "graph-studio", runId: run.id, nodeId: node.id, label: waitingOn!.label, question: waitingOn!.question } } : {}),
      },
    });
  }
  // A decision: a step that takes the first matching of several exits. Once
  // it has gone one way, the exits it did not take are drawn struck through.
  const exits = new Map<string, string[]>();
  for (const edge of layout.edges) {
    if (edge.isBack || pseudo.has(edge.from) || pseudo.has(edge.to)) continue;
    exits.set(edge.from, [...(exits.get(edge.from) ?? []), edge.to]);
  }
  const ran = (nodeId: string) => latest.has(nodeId);
  const decisions = new Set(
    run.graph.nodes.filter((node) => (node.routing ?? "first") === "first" && (exits.get(node.id)?.length ?? 0) > 1).map((node) => node.id),
  );
  for (const nodeId of decisions) {
    const card = layer.nodes.find((node) => node.id === idOf.get(nodeId));
    if (card) card.meta = { ...card.meta, decision: true };
  }
  for (const edge of layout.edges) {
    if (pseudo.has(edge.from) || pseudo.has(edge.to)) continue;
    const from = idOf.get(edge.from);
    const to = idOf.get(edge.to);
    if (!from || !to) continue;
    const step: CanvasEdge = { from, to, variant: edge.isBack ? "back" : "step" };
    if (edge.label) step.label = edge.label;
    const decided = !edge.isBack && decisions.has(edge.from) && (exits.get(edge.from) ?? []).some((other) => other !== edge.to && ran(other));
    if (decided && !ran(edge.to)) step.state = "skipped";
    layer.edges.push(step);
  }
  foldFlow(layer, runId);
}

/** Lanes a layer shows before the rest fold into "+N" (Form B). */
export const MAX_LANES = 4;
/** A branch longer than this makes a branched flow big (Form B). */
export const LONG_BRANCH = 3;

const RANK: Record<string, number> = { running: 0, waiting: 0, failed: 1, done: 2 };

/**
 * BBP-303 Form B: a big flow — more than MAX_LANES parallel lanes, or a
 * branch longer than LONG_BRANCH next to another — draws each straight
 * branch as one card (its current step, "k/n steps") and folds lanes beyond
 * MAX_LANES into one "+N" card. Small flows stay one card per step (Form A).
 */
export function foldFlow(layer: CanvasLayer, runId: string): void {
  const steps = layer.nodes.filter((node) => node.parentId === runId && node.meta?.step === true);
  const ids = new Set(steps.map((node) => node.id));
  const forward = layer.edges.filter((edge) => edge.variant === "step" && ids.has(edge.from) && ids.has(edge.to));
  const outs = new Map<string, string[]>();
  const ins = new Map<string, string[]>();
  for (const edge of forward) {
    outs.set(edge.from, [...(outs.get(edge.from) ?? []), edge.to]);
    ins.set(edge.to, [...(ins.get(edge.to) ?? []), edge.from]);
  }
  // A chain continues through a node with one way in from a node with one way out.
  const continues = (id: string) => (ins.get(id) ?? []).length === 1 && (outs.get(ins.get(id)![0]!) ?? []).length === 1;
  const chains: string[][] = [];
  for (const node of steps) {
    if (continues(node.id)) continue;
    const chain = [node.id];
    for (let next = outs.get(node.id) ?? []; next.length === 1 && continues(next[0]!); next = outs.get(chain.at(-1)!) ?? []) chain.push(next[0]!);
    chains.push(chain);
  }
  const lanesPerLayer = new Map<unknown, number>();
  for (const node of steps) lanesPerLayer.set(node.meta?.layer, (lanesPerLayer.get(node.meta?.layer) ?? 0) + 1);
  const widest = Math.max(0, ...lanesPerLayer.values());
  const branched = widest > 1;
  const big = widest > MAX_LANES || (branched && chains.some((chain) => chain.length > LONG_BRANCH));
  if (!big) return;

  const byId = new Map(steps.map((node) => [node.id, node]));
  const rename = new Map<string, string>();
  const drop = new Set<string>();
  for (const chain of chains) {
    if (chain.length < 2) continue;
    const members = chain.map((id) => byId.get(id)!);
    // The card shows the step that matters now: running or waiting, else the last that ran.
    const ran = members.filter((node) => node.status !== undefined);
    const shown = [...ran].sort((a, b) => (RANK[a.status!] ?? 3) - (RANK[b.status!] ?? 3))[0] ?? ran.at(-1) ?? members[0]!;
    const done = members.filter((node) => node.status === "done").length;
    shown.meta = { ...shown.meta, layer: members[0]!.meta?.layer, lane: members[0]!.meta?.lane, branch: { done, total: chain.length, steps: members.map((node) => node.label) } };
    for (const node of members) if (node !== shown) {
      drop.add(node.id);
      rename.set(node.id, shown.id);
    }
  }
  // Lanes beyond MAX_LANES fold into one "+N" card per layer.
  const remaining = steps.filter((node) => !drop.has(node.id));
  const layers = new Map<unknown, CanvasNode[]>();
  for (const node of remaining) layers.set(node.meta?.layer, [...(layers.get(node.meta?.layer) ?? []), node]);
  const folds: CanvasNode[] = [];
  for (const [index, lanes] of layers) {
    if (lanes.length <= MAX_LANES) continue;
    const sorted = [...lanes].sort((a, b) => Number(a.meta?.lane ?? 0) - Number(b.meta?.lane ?? 0));
    // Lanes that need you or run stay visible; the quiet ones fold.
    const keep = [...sorted].sort((a, b) => (RANK[a.status ?? ""] ?? 3) - (RANK[b.status ?? ""] ?? 3)).slice(0, MAX_LANES - 1);
    const hidden = sorted.filter((node) => !keep.includes(node));
    const fold: CanvasNode = {
      id: `fold:${runId}:${String(index)}`,
      kind: "step",
      label: `+${hidden.length}`,
      parentId: runId,
      meta: { step: true, layer: index, lane: MAX_LANES, folded: hidden.length, steps: hidden.map((node) => node.label) },
    };
    folds.push(fold);
    for (const node of hidden) {
      drop.add(node.id);
      rename.set(node.id, fold.id);
    }
  }
  // A folded step's threads stay taken by the card that stands for it, so the
  // Canvas does not draw them again as loose threads.
  const targets = new Map([...remaining, ...folds].map((node) => [node.id, node]));
  for (const id of drop) {
    let target = rename.get(id);
    while (target && drop.has(target)) target = rename.get(target);
    const card = target ? targets.get(target) : undefined;
    const node = byId.get(id);
    if (!card || !node) continue;
    const own = Array.isArray(node.meta?.attemptThreads) ? (node.meta.attemptThreads as string[]) : [];
    const theirs = Array.isArray(card.meta?.attemptThreads) ? (card.meta.attemptThreads as string[]) : [];
    card.meta = { ...card.meta, attemptThreads: [...new Set([...theirs, ...own])] };
  }
  for (const [id, target] of rename) {
    let final = target;
    while (drop.has(final) && rename.has(final)) final = rename.get(final)!;
    rename.set(id, final);
  }
  layer.nodes = [...layer.nodes.filter((node) => !drop.has(node.id)), ...folds];
  const seen = new Set<string>();
  layer.edges = layer.edges.flatMap((edge) => {
    const from = rename.get(edge.from) ?? edge.from;
    const to = rename.get(edge.to) ?? edge.to;
    if (from === to) return [];
    const key = `${from}>${to}>${edge.variant ?? ""}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ ...edge, from, to }];
  });
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
