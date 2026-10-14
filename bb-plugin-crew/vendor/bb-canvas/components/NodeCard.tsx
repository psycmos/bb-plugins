// The one card shape every `CanvasNode` kind renders as. A navigation tree
// with a different card per kind drifts the moment one of them gets a new
// field and the others do not — one shape, and the kind says itself through
// the label and the icon slot the caller fills in.
//
// Colour means state, nothing else (BBP-214): a neutral card outside an
// error/running/waiting state never carries a colour of its own. `kind` is
// kept only for the caller's icon and the card's ARIA label, not the border.
import type { MouseEvent, ReactNode } from "react";
import type { CanvasNodeKind, CanvasStatus } from "../lib/types";
import { TIER_OF, TIER_TYPOGRAPHY, type Tier } from "../lib/tiers";

export type NodeCardProps = {
  label: string;
  subtitle?: string;
  status?: CanvasStatus;
  kind?: CanvasNodeKind;
  /** A single-colour line icon, left of the label. */
  icon?: ReactNode;
  selected?: boolean;
  /** The keyboard focus ring (BBP-290): a soft glow around the card J landed on. */
  halo?: boolean;
  /** Carries the click's modifier keys through (BBP-241: Ctrl/Cmd-click
   *  toggles focus instead of selecting). */
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  /** Outside the frame currently being edited (BBP-166): faded and locked,
   *  not merely unclickable — a reader must see at a glance which layer is
   *  live right now. */
  dimmed?: boolean;
  /** A card that can open gets a chevron beside it (BBP-183); a leaf gets
   *  none. Collapsed, the chevron also carries the child count. */
  expander?: { expanded: boolean; childCount: number; onToggle: () => void };
  /** A lazy load that failed (BBP-179): replaces the subtitle with a visible
   *  "Could not load activity" instead of leaving the card looking like it
   *  simply has nothing — the destructive border wins even over a neutral
   *  `status`, and clicking the card (or its chevron) retries. */
  loadFailed?: boolean;
  /** The type colour (BBP-298), carried by the icon alone: a tinted square
   *  behind it. The card's border stays neutral. Absent: the neutral card. */
  accent?: string;
};

const AMBER = "var(--warning)";

const PULSE_CLASS = "bb-canvas-pulse";
const STYLE_ID = "bb-canvas-node-card-styles";

/** Injected once, module-wide: React has no `@keyframes`, and a reader who
 *  asked their OS for less motion must get a still (but still legible)
 *  "running" card, not a silent downgrade to "idle". */
function ensurePulseStyles(): void {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    @keyframes ${PULSE_CLASS} {
      0%, 100% { box-shadow: 0 0 0 0 color-mix(in oklab, var(--primary) 55%, transparent); }
      50% { box-shadow: 0 0 0 4px transparent; }
    }
    .${PULSE_CLASS} { animation: ${PULSE_CLASS} 1.6s ease-in-out infinite; }
    @media (prefers-reduced-motion: reduce) {
      .${PULSE_CLASS} { animation: none; box-shadow: 0 0 0 2px var(--primary); }
    }
  `;
  document.head.appendChild(style);
}

type Visual = { border: string; pulse: boolean; background: string; radius: number };

const CARD_RADIUS: Record<Tier, number> = { group: 0, card: 8, row: 6 };

/** A 15%-opacity wash of a status colour over the row's own fill — a plain
 *  border reads too thin at 26px tall, so a row that needs the human also
 *  gets a tinted background, not just an outline. */
function tint(color: string): string {
  return `color-mix(in oklab, ${color} 15%, var(--muted))`;
}

/** Only a state colours the border — a neutral card (idle, done, or no
 *  status at all) always gets the same plain line, regardless of `kind`. A
 *  group-tier node (agents/project/crew, BBP-221) is a headerless header row
 *  and never borders at all, whatever its status — it does not pulse either,
 *  the same accent a border would otherwise carry. A row-tier node (step,
 *  tool-call, …, BBP-223) borders only for waiting/failed/loadFailed, each
 *  paired with a tinted fill so the state still reads at its compact height;
 *  anything else stays the plain `var(--muted)` fill, no border — a running
 *  row is already shown by its incoming edge's "now" state. */
function visualFor(status: CanvasStatus | undefined, tier: Tier, loadFailed: boolean): Visual {
  const radius = CARD_RADIUS[tier];
  // Transparent: a header row sits on the canvas, not on a card-coloured block.
  if (tier === "group") return { border: "none", pulse: false, background: "transparent", radius };
  const failed = loadFailed || status === "failed";
  if (tier === "row") {
    if (failed) return { border: `1.5px solid var(--destructive)`, pulse: false, background: tint("var(--destructive)"), radius };
    if (status === "waiting") return { border: `2px dashed ${AMBER}`, pulse: false, background: tint(AMBER), radius };
    // A row at work gets the blue border too (BBP-298: every active card shows it).
    if (status === "running") return { border: `1.5px dashed var(--primary)`, pulse: false, background: "var(--muted)", radius };
    return { border: "none", pulse: false, background: "var(--muted)", radius };
  }
  if (failed) return { border: `1.5px solid var(--destructive)`, pulse: false, background: "var(--card)", radius };
  // 2px, not 1.5: the gaps of a dash take half the ink away, and this is the
  // state that needs the human — it must not read weaker than "running".
  if (status === "waiting") return { border: `2px dashed ${AMBER}`, pulse: false, background: "var(--card)", radius };
  if (status === "escalated") return { border: `1.5px solid ${AMBER}`, pulse: false, background: "var(--card)", radius };
  // Running: a dashed blue border, like the running path; a selected card
  // keeps its solid ring, so "at work" and "picked" never look alike (BBP-298).
  if (status === "running") {
    return { border: `1.5px dashed var(--primary)`, pulse: true, background: "var(--card)", radius };
  }
  return { border: `1px solid var(--border)`, pulse: false, background: "var(--card)", radius };
}

export function NodeCard({
  label,
  subtitle,
  status,
  kind,
  icon,
  selected = false,
  halo = false,
  onClick,
  dimmed = false,
  expander,
  loadFailed = false,
  accent,
}: NodeCardProps) {
  ensurePulseStyles();
  const tier: Tier = kind !== undefined ? TIER_OF[kind] : "card";
  const typo = TIER_TYPOGRAPHY[tier];
  const { border, pulse, background, radius } = visualFor(status, tier, loadFailed);
  const errorText = loadFailed ? "Could not load activity" : undefined;
  const effectiveSubtitle = errorText ?? subtitle;
  // Group: the counter rides beside the title, no second line — 28px has
  // room for one. Card: counter/subtitle sits on its own line below. Row:
  // no secondary text at all, however compact its title already is.
  const showInline = tier === "group" && Boolean(effectiveSubtitle);
  const showBelow = tier === "card" && Boolean(effectiveSubtitle);
  const card = (
    <button
      type="button"
      aria-label={effectiveSubtitle ? `${label} — ${effectiveSubtitle}` : label}
      aria-pressed={selected}
      data-halo={halo ? "true" : undefined}
      aria-disabled={dimmed}
      onClick={dimmed ? undefined : onClick}
      className={pulse ? PULSE_CLASS : undefined}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        width: "100%",
        height: "100%",
        padding: tier === "card" ? "6px 10px" : "0 10px",
        borderRadius: radius,
        border,
        // --ring, the same ink as the selected-path edge, so ring and path read
        // as one selection rather than as another "running" accent.
        outline: selected ? "2px solid var(--ring)" : "none",
        outlineOffset: 2,
        ...(halo ? { boxShadow: "0 0 0 6px color-mix(in srgb, var(--ring) 35%, transparent)" } : {}),
        background,
        color: "var(--foreground)",
        textAlign: "left",
        cursor: dimmed ? "default" : "pointer",
        opacity: dimmed ? 0.35 : 1,
        // React Flow marks a non-selectable, non-draggable node's own wrapper
        // `pointer-events: none` — an optimization that, left alone, blocks
        // every click reaching the card inside it too, since the CSS property
        // inherits down through descendants. A dimmed card locks the same way
        // on purpose: outside the frame being edited, nothing is selectable.
        pointerEvents: dimmed ? "none" : "auto",
      }}
    >
      {icon ? (
        <span
          aria-hidden
          data-bb-accent={accent}
          style={
            accent
              ? {
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  width: tier === "row" ? 18 : 24,
                  height: tier === "row" ? 18 : 24,
                  borderRadius: 6,
                  color: accent,
                  background: `color-mix(in oklab, ${accent} 16%, transparent)`,
                }
              : { display: "flex", flexShrink: 0 }
          }
        >
          {icon}
        </span>
      ) : null}
      <span
        style={{
          display: "flex",
          minWidth: 0,
          flexDirection: tier === "card" ? "column" : "row",
          alignItems: tier === "card" ? undefined : "baseline",
          gap: tier === "group" ? 6 : undefined,
          flex: 1,
        }}
      >
        <span
          title={label}
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontSize: typo.titleSize,
            fontWeight: typo.titleWeight,
            minWidth: tier === "row" ? 0 : undefined,
            flex: tier === "row" ? 1 : undefined,
          }}
        >
          {label}
        </span>
        {showInline ? (
          <span
            title={effectiveSubtitle}
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              flexShrink: 0,
              fontSize: typo.subSize,
              fontWeight: typo.subWeight,
              color: "var(--muted-foreground)",
            }}
          >
            {effectiveSubtitle}
          </span>
        ) : null}
        {showBelow ? (
          <span
            title={effectiveSubtitle}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontSize: typo.subSize,
              fontWeight: typo.subWeight,
              color: errorText ? "var(--destructive)" : "var(--muted-foreground)",
            }}
          >
            {errorText ? (
              <svg
                aria-hidden
                width={10}
                height={10}
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ flexShrink: 0 }}
              >
                <path d="M8 2.5 1.5 13.5h13z" />
                <path d="M8 6.5v3.5M8 12h.01" />
              </svg>
            ) : null}
            {effectiveSubtitle}
          </span>
        ) : null}
      </span>
      {status === "done" ? (
        <svg
          aria-hidden
          data-bb-done-check
          width={12}
          height={12}
          viewBox="0 0 16 16"
          fill="none"
          stroke="var(--muted-foreground)"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ flexShrink: 0 }}
        >
          <path d="M3.5 8.5l3 3 6-7" />
        </svg>
      ) : tier !== "group" && status ? (
        <StatusGlyph status={loadFailed ? "failed" : status} />
      ) : null}
    </button>
  );
  if (!expander) return card;
  // A sibling of the card, not inside it: a button in a button is invalid
  // and would select the card on every toggle.
  const count = !expander.expanded && expander.childCount > 0 ? expander.childCount : null;
  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      {card}
      <button
        type="button"
        aria-label={`${expander.expanded ? "Collapse" : "Expand"} ${label}${count !== null ? ` (${count} ${count === 1 ? "child" : "children"})` : ""}`}
        aria-expanded={expander.expanded}
        disabled={dimmed}
        onClick={(event) => {
          event.stopPropagation();
          expander.onToggle();
        }}
        style={{
          position: "absolute",
          right: -10,
          top: "50%",
          transform: "translateY(-50%)",
          display: "flex",
          alignItems: "center",
          gap: 2,
          height: 20,
          minWidth: 20,
          padding: "0 4px",
          borderRadius: 10,
          // Collapsed with children is the state to notice, so it gets the
          // foreground ink; open chevrons stay quiet.
          border: `1px solid ${count !== null ? "var(--muted-foreground)" : "var(--border)"}`,
          background: "var(--card)",
          color: count !== null ? "var(--foreground)" : "var(--muted-foreground)",
          fontSize: 10,
          fontWeight: count !== null ? 600 : 400,
          fontVariantNumeric: "tabular-nums",
          lineHeight: 1,
          cursor: dimmed ? "default" : "pointer",
          opacity: dimmed ? 0.35 : 1,
          pointerEvents: dimmed ? "none" : "auto",
        }}
      >
        <svg
          aria-hidden
          width={10}
          height={10}
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ transform: expander.expanded ? "rotate(90deg)" : undefined }}
        >
          <path d="M6 3l5 5-5 5" />
        </svg>
        {count !== null ? <span>{count}</span> : null}
      </button>
    </div>
  );
}

const GLYPH_PATHS: Partial<Record<CanvasStatus, { color: string; d: string[] }>> = {
  failed: { color: "var(--destructive)", d: ["M8 1.75a6.25 6.25 0 1 0 0 12.5 6.25 6.25 0 0 0 0-12.5z", "M8 5v3.5M8 11h.01"] },
  waiting: { color: AMBER, d: ["M8 1.75a6.25 6.25 0 1 0 0 12.5 6.25 6.25 0 0 0 0-12.5z", "M8 4.75V8l2.25 1.5"] },
  escalated: { color: AMBER, d: ["M8 1.75a6.25 6.25 0 1 0 0 12.5 6.25 6.25 0 0 0 0-12.5z", "M8 4.75V8l2.25 1.5"] },
};

/** The state, said once more at the trailing edge in its own colour: a dot
 *  for running, a line icon for failed/waiting, nothing for idle. Groups
 *  never get one — they carry no state colour at all. */
function StatusGlyph({ status }: { status: CanvasStatus }) {
  if (status === "running") {
    return (
      <span
        aria-hidden
        data-bb-status-glyph="running"
        title="running"
        style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          flexShrink: 0,
          background: "var(--primary)",
          boxShadow: "0 0 0 3px color-mix(in oklab, var(--primary) 25%, transparent)",
        }}
      />
    );
  }
  const glyph = GLYPH_PATHS[status];
  if (!glyph) return null;
  return (
    <svg
      aria-hidden
      data-bb-status-glyph={status}
      width={13}
      height={13}
      viewBox="0 0 16 16"
      fill="none"
      stroke={glyph.color}
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0 }}
    >
      <title>{status}</title>
      {glyph.d.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
