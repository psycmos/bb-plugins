// Details of the selected node: a header (icon, label, status), one section
// per kind with its curated fields (BBP-185), and a collapsed "Details"
// block for everything else a provider put in `meta`. A chat or replay feed
// for `thread`/`turn` nodes is a later ticket, once there is a timeline to
// lazily load into this same slot.
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { clampWidth, DEFAULT_WIDTH, fitWidth, maxWidthFor, MIN_WIDTH } from "../lib/clampWidth";
import { curateMeta, type CanvasNode, type CuratedField, type CanvasStatus } from "../lib/types";
import type { RelationGroup } from "../lib/relations";
import { KindIcon, KIND_LABEL } from "./KindIcon";

const WIDTH_KEY = "bb-canvas:sidebar-width";
const KEY_STEP = 16;

/** Never throws — same reasoning as the colour mode in CanvasView: no or a
 *  broken `localStorage` means the default width, not a crashed canvas. */
function loadWidth(): number {
  try {
    const stored = localStorage.getItem(WIDTH_KEY);
    // `Number(null)` is 0, which would clamp to the minimum instead of the default.
    return stored === null ? DEFAULT_WIDTH : clampWidth(Number(stored));
  } catch {
    return DEFAULT_WIDTH;
  }
}

function saveWidth(width: number): void {
  try {
    localStorage.setItem(WIDTH_KEY, String(width));
  } catch {
    // Not persisted; the width still holds for this session.
  }
}

/** One fixed pill colour per status — the same precedence NodeCard's border
 *  uses, just as a background instead of an outline. */
const STATUS_COLOR: Record<CanvasStatus, string> = {
  idle: "var(--muted-foreground)",
  running: "var(--primary)",
  waiting: "var(--warning)",
  done: "var(--muted-foreground)",
  failed: "var(--destructive)",
  escalated: "var(--warning)",
};

function StatusPill({ status }: { status: CanvasStatus }) {
  const color = STATUS_COLOR[status];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        flexShrink: 0,
        height: 18,
        padding: "0 7px",
        borderRadius: 999,
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: "0.02em",
        color,
        // A tint of the status colour, not a bare outline: it keeps the pill
        // legible on both themes without a hex value per theme.
        background: `color-mix(in oklab, ${color} 12%, transparent)`,
        border: `1px solid color-mix(in oklab, ${color} 45%, transparent)`,
      }}
    >
      {status[0].toUpperCase() + status.slice(1)}
    </span>
  );
}

/** Inline because bb-canvas cannot import BB's Button: the same tokens, the
 *  same 28 px height, and a focus ring from `:focus-visible` in SIDEBAR_CSS. */
const ACTION_STYLE = {
  display: "inline-flex",
  alignItems: "center",
  height: 28,
  padding: "0 10px",
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "var(--card)",
  color: "var(--foreground)",
  fontSize: 12,
  fontWeight: 500,
  cursor: "pointer",
} as const;

const SIDEBAR_STYLE_ID = "bb-canvas-sidebar-styles";

/** Hover and focus states need real selectors; injected once, like the
 *  pulse in NodeCard. */
const SIDEBAR_CSS = `
  .bb-canvas-action:hover { background: var(--muted); }
  .bb-canvas-action:focus-visible { outline: 2px solid var(--primary); outline-offset: 1px; }
  .bb-canvas-resize::after {
    content: ""; position: absolute; top: 0; bottom: 0; left: 3px; width: 1px;
    background: transparent; transition: background 120ms ease-out;
  }
  .bb-canvas-resize:hover::after { background: var(--border); width: 2px; left: 2px; }
  .bb-canvas-resize:focus-visible { outline: none; }
  .bb-canvas-resize:focus-visible::after, .bb-canvas-resize:active::after {
    background: var(--primary); width: 2px; left: 2px;
  }
`;

function ensureSidebarStyles(): void {
  if (typeof document === "undefined" || document.getElementById(SIDEBAR_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = SIDEBAR_STYLE_ID;
  style.textContent = SIDEBAR_CSS;
  document.head.appendChild(style);
}

function SectionHeading({ children }: { children: string }) {
  return (
    <h3
      style={{
        margin: 0,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        color: "var(--muted-foreground)",
      }}
    >
      {children}
    </h3>
  );
}

// Long values (a full shell command, raw tool output) would otherwise blow
// out the sidebar's main body; truncated here, with the full value one
// click away rather than silently absent (BBP-206 review round 1).
const LONG_VALUE_THRESHOLD = 140;

function FieldValue({ value }: { value: string }) {
  const [expanded, setExpanded] = useState(false);
  if (value.length <= LONG_VALUE_THRESHOLD) return <>{value}</>;
  return (
    <>
      {expanded ? value : `${value.slice(0, LONG_VALUE_THRESHOLD)}…`}{" "}
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="bb-canvas-action"
        style={{ ...ACTION_STYLE, height: 20, padding: "0 6px", fontSize: 11 }}
      >
        {expanded ? "less" : "more"}
      </button>
    </>
  );
}

// Machine text (a shell command, tool input, raw output) reads as code, not
// prose: monospace on a quiet well, whitespace kept (BBP-206 design).
const CODE_FIELDS = new Set(["Command", "Input", "Output", "Detail", "Stdout", "Stderr", "Query"]);

const CODE_STYLE = {
  display: "block",
  margin: 0,
  padding: "6px 8px",
  borderRadius: 6,
  background: "var(--muted)",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: 11,
  lineHeight: 1.45,
  whiteSpace: "pre-wrap",
} as const;

/** The values on a tool call that say "this failed" — a non-zero exit code,
 *  an error, stderr — carry the destructive colour, not the body colour. */
function isFailedExit(field: { label: string; value: string }): boolean {
  return (field.label === "Exit code" && field.value !== "0") || field.label === "Error" || field.label === "Stderr";
}

function FieldList({ fields }: { fields: { label: string; value: string }[] }) {
  return (
    <dl style={{ margin: 0, fontSize: 12, display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)", gap: "6px 12px", lineHeight: 1.4 }}>
      {fields.map((field) => {
        const code = CODE_FIELDS.has(field.label);
        return (
          <div key={field.label} style={{ display: "contents" }}>
            <dt style={{ color: "var(--muted-foreground)", paddingTop: code ? 6 : 0 }}>{field.label}</dt>
            <dd
              style={{
                margin: 0,
                overflowWrap: "anywhere",
                whiteSpace: "pre-line",
                ...(isFailedExit(field) ? { color: "var(--destructive)", fontWeight: 600 } : {}),
              }}
            >
              {code ? (
                <code style={CODE_STYLE}>
                  <FieldValue value={field.value} />
                </code>
              ) : (
                <FieldValue value={field.value} />
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/** A bundle's entries (each thought's text, each event's title) as their own
 *  readable items, separated, each long one behind its own "more" — not one
 *  run-together blob in the collapsed Details (BBP-206 R3 design). */
function EntryList({ title, entries }: { title: string; entries: readonly string[] }) {
  return (
    <section aria-label={title} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <SectionHeading>{`${title} (${entries.length})`}</SectionHeading>
      <ol style={{ margin: 0, padding: 0, listStyle: "none", fontSize: 12, lineHeight: 1.5 }}>
        {entries.map((entry, index) => (
          <li
            key={index}
            style={{
              padding: "8px 0",
              borderTop: index === 0 ? "none" : "1px solid var(--border)",
              overflowWrap: "anywhere",
              whiteSpace: "pre-line",
            }}
          >
            <FieldValue value={entry} />
          </li>
        ))}
      </ol>
    </section>
  );
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && entry !== "") : [];
}

export type SidebarProps = {
  node: CanvasNode;
  onClose: () => void;
  /** Shown as "Open thread" only when `meta.threadId` is a string. */
  onOpenThread?: (threadId: string) => void;
  /** Shown as "Open run" only when `meta.runId` is a string. */
  onOpenRun?: (runId: string) => void;
  /** Shown as "Open crew" only when `meta.crew` is a string. */
  onOpenCrew?: (crew: string) => void;
  /** Shown as "Open in thread" only when `meta.threadId` is a string and
   *  `meta.sourceSeq` is a number; it then replaces "Open thread", which
   *  would open the same thread a second way. */
  onOpenAtRow?: (threadId: string, seq: number) => void;
  /** The node's own relations by kind (BBP-203); a target's name selects it
   *  through `onSelect`. Empty or absent: no section. */
  relations?: readonly RelationGroup[];
  onSelect?: (nodeId: string) => void;
  /** Shown as "Focus this" only for a crew/graph-run/thread node (BBP-242);
   *  replaces the whole focus selection with just this node's id. */
  onFocusThis?: (id: string) => void;
  /** A page-owned section after the relations (BBP-291). */
  extra?: ReactNode;
  /** Above everything else — the canvas's breadcrumb (BBP-298). */
  header?: ReactNode;
};

const FOCUSABLE_KINDS = new Set<CanvasNode["kind"]>(["crew", "graph-run", "thread"]);

function stringMeta(node: CanvasNode, key: string): string | undefined {
  const value = node.meta?.[key];
  return typeof value === "string" && value !== "" ? value : undefined;
}

function numberMeta(node: CanvasNode, key: string): number | undefined {
  const value = node.meta?.[key];
  return typeof value === "number" ? value : undefined;
}

export function Sidebar({ node, onClose, onOpenThread, onOpenRun, onOpenCrew, onOpenAtRow, relations = [], onSelect, onFocusThis, extra, header }: SidebarProps) {
  const { curated, details: allDetails, debug } = curateMeta(node.kind, node.meta);
  // A bundle's `titles` render as their own list below, not again in Details.
  const entries = stringList(node.meta?.titles);
  const details = entries.length > 0 ? allDetails.filter((field) => field.label !== "Events") : allDetails;
  const entriesTitle = /\bthoughts?\b/.test(node.label) ? "Thoughts" : "Events";
  const runId = onOpenRun ? stringMeta(node, "runId") : undefined;
  const crew = onOpenCrew ? stringMeta(node, "crew") : undefined;
  const atRowThreadId = onOpenAtRow ? stringMeta(node, "threadId") : undefined;
  const atRowSeq = onOpenAtRow ? numberMeta(node, "sourceSeq") : undefined;
  const atRow = atRowThreadId !== undefined && atRowSeq !== undefined ? { threadId: atRowThreadId, seq: atRowSeq } : undefined;
  const threadId = onOpenThread && atRow === undefined ? stringMeta(node, "threadId") : undefined;
  const canFocusThis = onFocusThis !== undefined && FOCUSABLE_KINDS.has(node.kind);
  const hasActions = threadId !== undefined || runId !== undefined || crew !== undefined || atRow !== undefined || canFocusThis;
  const [width, setWidth] = useState(loadWidth);
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);
  const asideRef = useRef<HTMLElement>(null);
  // The row the sidebar shares with the canvas; 0 until measured.
  const [containerWidth, setContainerWidth] = useState(0);
  // `width` stays the user's choice (and what is stored); `shown` is that
  // choice capped for a narrow panel, so widening the panel brings it back.
  const shown = fitWidth(width, containerWidth);
  const shownMax = maxWidthFor(containerWidth);

  useEffect(() => {
    const container = asideRef.current?.parentElement;
    if (!container) return;
    setContainerWidth(container.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setContainerWidth(container.clientWidth));
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => saveWidth(width), [width]);
  useEffect(ensureSidebarStyles, []);

  useEffect(() => {
    // The handle sits on the left edge, so moving the pointer left widens.
    const onMove = (event: globalThis.MouseEvent) => {
      if (!drag.current) return;
      setWidth(clampWidth(drag.current.startWidth + drag.current.startX - event.clientX));
    };
    const onUp = () => {
      drag.current = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const startDrag = (event: MouseEvent) => {
    event.preventDefault();
    drag.current = { startX: event.clientX, startWidth: shown };
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const next: Record<string, number> = {
      // From what is on screen, so a key always moves the visible edge.
      ArrowLeft: shown + KEY_STEP,
      ArrowRight: shown - KEY_STEP,
      Home: MIN_WIDTH,
      End: shownMax,
    };
    if (!(event.key in next)) return;
    event.preventDefault();
    setWidth(clampWidth(next[event.key]));
  };

  return (
    <aside
      ref={asideRef}
      aria-label={`Details for ${node.label}`}
      // Scrolling a long details list must not pan the canvas underneath it
      // (BBP-199) — React Flow skips its own wheel handling for this class.
      className="nowheel"
      style={{
        position: "relative",
        // border-box: the clamped value is the width on screen, padding and border included.
        boxSizing: "border-box",
        width: shown,
        flexShrink: 0,
        borderLeft: "1px solid var(--border)",
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 16,
        overflowY: "auto",
        background: "var(--background)",
        color: "var(--foreground)",
      }}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize details"
        aria-valuenow={shown}
        aria-valuemin={Math.min(MIN_WIDTH, shownMax)}
        aria-valuemax={shownMax}
        tabIndex={0}
        onMouseDown={startDrag}
        onKeyDown={onKeyDown}
        className="bb-canvas-resize"
        style={{ position: "absolute", left: -4, top: 0, bottom: 0, width: 8, cursor: "col-resize", zIndex: 1 }}
      />
      {header}
      <header style={{ display: "flex", alignItems: "start", gap: 10 }}>
        <span
          aria-hidden
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            width: 28,
            height: 28,
            borderRadius: 6,
            border: "1px solid var(--border)",
            color: "var(--muted-foreground)",
          }}
        >
          <KindIcon kind={node.kind} />
        </span>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
            <span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>{KIND_LABEL[node.kind]}</span>
            {node.status ? <StatusPill status={node.status} /> : null}
          </div>
          <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600, lineHeight: 1.3, overflowWrap: "anywhere" }}>
            {node.label}
          </h2>
        </div>
        <button
          type="button"
          aria-label="Close details"
          onClick={onClose}
          className="bb-canvas-action"
          style={{ ...ACTION_STYLE, justifyContent: "center", width: 28, padding: 0, border: "none", background: "transparent", color: "var(--muted-foreground)" }}
        >
          <svg aria-hidden width={14} height={14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </header>
      {curated.length > 0 ? (
        <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <SectionHeading>{KIND_LABEL[node.kind]}</SectionHeading>
          <FieldList fields={curated} />
        </section>
      ) : null}
      {entries.length > 0 ? <EntryList title={entriesTitle} entries={entries} /> : null}
      {relations.length > 0 ? (
        <section aria-label="Relations" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {relations.map((group) => (
            <div key={group.kind} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <SectionHeading>{group.kind}</SectionHeading>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {group.targets.map((target) => (
                  <button
                    key={target.id}
                    type="button"
                    onClick={() => onSelect?.(target.id)}
                    className="bb-canvas-action"
                    style={ACTION_STYLE}
                  >
                    {target.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </section>
      ) : null}
      {extra}
      {hasActions ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {threadId !== undefined ? (
            <button type="button" onClick={() => onOpenThread?.(threadId)} className="bb-canvas-action" style={ACTION_STYLE}>
              Open thread
            </button>
          ) : null}
          {runId !== undefined ? (
            <button type="button" onClick={() => onOpenRun?.(runId)} className="bb-canvas-action" style={ACTION_STYLE}>
              Open run
            </button>
          ) : null}
          {crew !== undefined ? (
            <button type="button" onClick={() => onOpenCrew?.(crew)} className="bb-canvas-action" style={ACTION_STYLE}>
              Open crew
            </button>
          ) : null}
          {atRow !== undefined ? (
            <button type="button" onClick={() => onOpenAtRow?.(atRow.threadId, atRow.seq)} className="bb-canvas-action" style={ACTION_STYLE}>
              Open in thread
            </button>
          ) : null}
          {canFocusThis ? (
            <button type="button" onClick={() => onFocusThis?.(node.id)} className="bb-canvas-action" style={ACTION_STYLE}>
              Focus this
            </button>
          ) : null}
        </div>
      ) : null}
      {details.length > 0 ? <Collapsed title="Details" fields={details} /> : null}
      {debug.length > 0 ? <Collapsed title="Debug" fields={debug} /> : null}
    </aside>
  );
}

/** A closed-by-default block of fields under an uppercase summary. */
function Collapsed({ title, fields }: { title: string; fields: CuratedField[] }) {
  return (
    <details>
      <summary
        style={{
          cursor: "pointer",
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          color: "var(--muted-foreground)",
        }}
      >
        {title}
      </summary>
      <div style={{ marginTop: 8 }}>
        <FieldList fields={fields} />
      </div>
    </details>
  );
}
