// The tool-call terminal (BBP-312): a window over the canvas that lists every
// tool call on it as a log — type tag, command, duration bar, time. Dragged by
// its title bar, resized at its corner, kept inside the canvas, folded to a
// capsule; where it sits and how big it is survive a reload. A row selects its
// card, and a selected card marks its row.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { durationMs, TYPE_COLORS, TYPE_TAGS, typeKey, type TypeColorKey } from "../vendor/bb-canvas/lib/kind-colors";
import type { CanvasNode } from "../vendor/bb-canvas/lib/types";

const KEY = "bb-canvas:terminal";
export const MIN_SIZE = { width: 360, height: 120 };
export const DEFAULT_SIZE = { width: 560, height: 200 };
/** Space kept clear of the canvas's edge, and of the zoom island on the left. */
const INSET = 12;
const ROW_HEIGHT = 22;
const TITLE_HEIGHT = 30;

export type TerminalBox = { x: number; y: number; width: number; height: number; minimized: boolean };

function loadBox(): TerminalBox | null {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<TerminalBox> | null;
    if (!raw || ![raw.x, raw.y, raw.width, raw.height].every((value) => typeof value === "number" && Number.isFinite(value))) return null;
    return { x: raw.x!, y: raw.y!, width: raw.width!, height: raw.height!, minimized: raw.minimized === true };
  } catch {
    return null;
  }
}

function saveBox(box: TerminalBox): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(box));
  } catch {
    // Not persisted; the window still moves for this page.
  }
}

/** The box moved and shrunk as little as needed to sit inside `area`. */
export function clampBox(box: TerminalBox, area: { width: number; height: number }): TerminalBox {
  if (!(area.width > 0) || !(area.height > 0)) return box;
  const width = Math.max(Math.min(MIN_SIZE.width, area.width - 2 * INSET), Math.min(box.width, area.width - 2 * INSET));
  const height = Math.max(Math.min(MIN_SIZE.height, area.height - 2 * INSET), Math.min(box.height, area.height - 2 * INSET));
  const x = Math.min(Math.max(INSET, box.x), area.width - INSET - width);
  const y = Math.min(Math.max(INSET, box.y), area.height - INSET - height);
  return { ...box, x, y, width, height };
}

export type TerminalLine = { id: string; tag: string; color: string; text: string; detail: string; running: boolean; bar: number | null; key: TypeColorKey };

/** The node's thread: itself if it is one, else the nearest thread above it. */
function threadOf(byId: ReadonlyMap<string, CanvasNode>, id: string | null): string | null {
  for (let node = id === null ? undefined : byId.get(id); node; node = node.parentId === null ? undefined : byId.get(node.parentId))
    if (node.kind === "thread") return node.id;
  return null;
}

/** Tool calls on the canvas, in canvas order; with a selection inside a
 *  thread, only that thread's. */
export function terminalLines(nodes: readonly CanvasNode[], selectedId: string | null): { lines: TerminalLine[]; scope: string | null } {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const scopeId = threadOf(byId, selectedId);
  const calls = nodes.filter((node) => (node.kind === "tool-call" || node.kind === "subagent") && (scopeId === null || threadOf(byId, node.id) === scopeId));
  const longest = Math.max(0, ...calls.map((node) => durationMs(node.meta?.duration) ?? 0));
  const lines = calls.map((node): TerminalLine => {
    const key = typeKey(node);
    const ms = durationMs(node.meta?.duration);
    const command = typeof node.meta?.command === "string" && node.meta.command !== "" ? node.meta.command : node.label;
    const running = node.status === "running";
    return {
      id: node.id,
      key,
      tag: TYPE_TAGS[key],
      color: TYPE_COLORS[key],
      text: command,
      detail: running ? "running" : typeof node.meta?.duration === "string" ? node.meta.duration : "",
      running,
      bar: ms !== null && longest > 0 ? ms / longest : null,
    };
  });
  return { lines, scope: scopeId === null ? null : (byId.get(scopeId)?.label ?? null) };
}

export type ToolCallTerminalProps = {
  nodes: readonly CanvasNode[];
  selectedId: string | null;
  onSelect: (nodeId: string) => void;
  onClose: () => void;
};

export function ToolCallTerminal({ nodes, selectedId, onSelect, onClose }: ToolCallTerminalProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const [area, setArea] = useState({ width: 0, height: 0 });
  const [box, setBoxState] = useState<TerminalBox | null>(loadBox);
  const [follow, setFollow] = useState(true);
  const [only, setOnly] = useState<TypeColorKey | "all">("all");
  const gesture = useRef<{ kind: "move" | "resize"; startX: number; startY: number; from: TerminalBox } | null>(null);

  // The canvas area this window lives in; measured, since it changes with
  // the panel's width and the window's size.
  useLayoutEffect(() => {
    const area = hostRef.current?.parentElement;
    if (!area) return;
    const measure = () => setArea({ width: area.clientWidth, height: area.clientHeight });
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(area);
    return () => observer.disconnect();
  }, []);

  const placed = useMemo(() => {
    const start = box ?? { x: (area.width - DEFAULT_SIZE.width) / 2, y: area.height - DEFAULT_SIZE.height - INSET, ...DEFAULT_SIZE, minimized: false };
    return clampBox(start, area);
  }, [box, area]);
  const setBox = (next: TerminalBox) => {
    saveBox(next);
    setBoxState(next);
  };

  const { lines: all, scope } = useMemo(() => terminalLines(nodes, selectedId), [nodes, selectedId]);
  const lines = only === "all" ? all : all.filter((line) => line.key === only);
  const kinds = [...new Set(all.map((line) => line.key))];
  const running = all.filter((line) => line.running).length;

  // Following keeps the newest line in view; a selected card brings its own
  // line into view instead.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const selectedRow = selectedId === null ? null : list.querySelector<HTMLElement>(`[data-line="${CSS.escape(selectedId)}"]`);
    if (selectedRow) selectedRow.scrollIntoView?.({ block: "nearest" });
    else if (follow) list.scrollTop = list.scrollHeight;
  }, [lines.length, selectedId, follow]);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const current = gesture.current;
      if (!current) return;
      const dx = event.clientX - current.startX;
      const dy = event.clientY - current.startY;
      const next =
        current.kind === "move"
          ? { ...current.from, x: current.from.x + dx, y: current.from.y + dy }
          : { ...current.from, width: Math.max(MIN_SIZE.width, current.from.width + dx), height: Math.max(MIN_SIZE.height, current.from.height + dy) };
      setBoxState(next);
    };
    const onUp = () => {
      if (!gesture.current) return;
      gesture.current = null;
      setBoxState((current) => {
        if (current) saveBox(current);
        return current;
      });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  const start = (kind: "move" | "resize") => (event: ReactPointerEvent) => {
    if ((event.target as HTMLElement).closest("button, select") && kind === "move") return;
    event.preventDefault();
    gesture.current = { kind, startX: event.clientX, startY: event.clientY, from: placed };
  };

  const shell = "absolute z-20 overflow-hidden rounded-lg border border-border bg-background shadow-xl";

  if (placed.minimized)
    return (
      <div ref={hostRef} className="contents">
        <button
          type="button"
          aria-label="Restore tool calls"
          onClick={() => setBox({ ...placed, minimized: false })}
          className={`${shell} flex h-8 max-w-[320px] items-center gap-2 px-3 text-[11px] text-foreground hover:bg-muted`}
          style={{ left: 56, bottom: INSET }}
        >
          {running > 0 ? <span aria-hidden className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-primary" /> : null}
          <span className="shrink-0 whitespace-nowrap font-medium">{running > 0 ? `${running} running` : `${all.length} tool calls`}</span>
          {all.length > 0 ? <span className="min-w-0 truncate font-mono text-muted-foreground">{all[all.length - 1]!.text}</span> : null}
          <span aria-hidden>⤢</span>
        </button>
      </div>
    );

  return (
    <div ref={hostRef} className="contents">
      <section
        aria-label="Tool calls"
        className={`${shell} nowheel flex flex-col`}
        style={{ left: placed.x, top: placed.y, width: placed.width, height: placed.height }}
      >
        <div
          onPointerDown={start("move")}
          className="flex shrink-0 cursor-move select-none items-center gap-2 border-b border-border bg-card px-2.5 text-[11px]"
          style={{ height: TITLE_HEIGHT }}
        >
          <span aria-hidden className="text-muted-foreground">⠿</span>
          <span className="font-medium">Tool calls</span>
          <span className="min-w-0 flex-1 truncate text-muted-foreground">{scope ? `· ${scope}` : "· all on the canvas"}</span>
          <select
            aria-label="Tool call type"
            value={only}
            onChange={(event) => setOnly(event.target.value as TypeColorKey | "all")}
            className="rounded border border-border bg-background px-1 py-0.5 text-[11px]"
          >
            <option value="all">All types</option>
            {kinds.map((key) => (
              <option key={key} value={key}>
                {TYPE_TAGS[key]}
              </option>
            ))}
          </select>
          <button
            type="button"
            aria-pressed={follow}
            onClick={() => setFollow(!follow)}
            className={`rounded-full border px-2 py-0.5 ${follow ? "border-primary/50 bg-primary/10 text-foreground" : "border-border text-muted-foreground"}`}
          >
            ● Follow
          </button>
          <button type="button" aria-label="Minimize tool calls" onClick={() => setBox({ ...placed, minimized: true })} className="rounded px-1 text-muted-foreground hover:text-foreground">
            ▁
          </button>
          <button type="button" aria-label="Close tool calls (T)" onClick={onClose} className="rounded px-1 text-muted-foreground hover:text-foreground">
            ✕
          </button>
        </div>
        <ol
          ref={listRef}
          onScroll={(event) => {
            const list = event.currentTarget;
            // Scrolling up stops following; back at the bottom, it resumes.
            const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < ROW_HEIGHT;
            if (atBottom !== follow) setFollow(atBottom);
          }}
          className="min-h-0 flex-1 overflow-y-auto py-1 font-mono text-[11px]"
        >
          {lines.length === 0 ? <li className="px-2.5 py-1 font-sans text-muted-foreground">No tool calls on the canvas. Open a thread to see its calls.</li> : null}
          {lines.map((line) => (
            <li key={line.id} data-line={line.id}>
              <button
                type="button"
                onClick={() => onSelect(line.id)}
                aria-current={line.id === selectedId ? "true" : undefined}
                title={line.text}
                className={`grid w-full items-center gap-2 px-2.5 text-left ${line.id === selectedId ? "bg-primary/15" : "hover:bg-muted"}`}
                style={{ gridTemplateColumns: "48px minmax(0,1fr) 72px 48px", height: ROW_HEIGHT }}
              >
                <span className="font-semibold" style={{ color: line.color }}>
                  {line.tag}
                </span>
                <span className="truncate text-foreground">{line.text}</span>
                <span className="h-[3px] rounded bg-muted">
                  {line.bar !== null ? <span className="block h-full rounded bg-primary/60" style={{ width: `${Math.max(4, line.bar * 100)}%` }} /> : null}
                </span>
                <span className={`text-right ${line.running ? "text-primary" : "text-muted-foreground"}`}>{line.detail}</span>
              </button>
            </li>
          ))}
        </ol>
        <div
          aria-hidden
          onPointerDown={start("resize")}
          className="absolute bottom-0 right-0 h-3 w-3 cursor-nwse-resize border-b-2 border-r-2 border-border"
        />
      </section>
    </div>
  );
}
