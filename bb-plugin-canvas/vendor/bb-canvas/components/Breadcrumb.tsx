// The path from the tree's root to the selected node. Nothing selected shows
// nothing — a breadcrumb with no destination is noise, not orientation.
import { useState } from "react";
import type { CanvasNode } from "../lib/types";

export type BreadcrumbProps = {
  nodes: readonly CanvasNode[];
  selectedId: string | null;
  onSelect: (nodeId: string) => void;
  /** The island over the canvas (BBP-309): one line, every segment cut to a
   *  width with its full text as a tooltip, and a long path folded in the
   *  middle behind "…". */
  floating?: boolean;
};

/** Longer than this, a floating path keeps its first and last two segments. */
export const FOLD_AFTER = 4;

/** The chain from the root down to `nodeId`, root first. A parent id missing
 *  from the set stops the chain there instead of throwing — the same rule
 *  `layoutTree` applies when it roots an orphaned node. */
export function pathTo(nodes: readonly CanvasNode[], nodeId: string): CanvasNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const path: CanvasNode[] = [];
  let current = byId.get(nodeId) ?? null;
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    path.unshift(current);
    seen.add(current.id);
    current = current.parentId !== null ? (byId.get(current.parentId) ?? null) : null;
  }
  return path;
}

/** Visible head, folded middle and visible tail of a path. */
export function foldPath<T>(path: readonly T[]): { head: T[]; folded: T[]; tail: T[] } {
  if (path.length <= FOLD_AFTER) return { head: [...path], folded: [], tail: [] };
  return { head: path.slice(0, 1), folded: path.slice(1, -2), tail: path.slice(-2) };
}

const SEGMENT = {
  background: "none",
  border: "none",
  padding: 0,
  font: "inherit",
  cursor: "pointer",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
} as const;

export function Breadcrumb({ nodes, selectedId, onSelect, floating = false }: BreadcrumbProps) {
  const [unfolded, setUnfolded] = useState(false);
  if (selectedId === null) return null;
  const path = pathTo(nodes, selectedId);
  if (path.length === 0) return null;

  if (!floating)
    return (
      <nav aria-label="Breadcrumb" style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 8px", fontSize: 12 }}>
        {path.map((node, index) => (
          <span key={node.id} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            {index > 0 ? <span aria-hidden>/</span> : null}
            <button
              type="button"
              onClick={() => onSelect(node.id)}
              style={{
                ...SEGMENT,
                whiteSpace: undefined,
                color: index === path.length - 1 ? "var(--foreground)" : "var(--muted-foreground)",
                fontWeight: index === path.length - 1 ? 600 : 400,
              }}
            >
              {node.label}
            </button>
          </span>
        ))}
      </nav>
    );

  const { head, folded, tail } = foldPath(path);
  const last = path[path.length - 1]!;
  const segment = (node: CanvasNode) => (
    <button
      key={node.id}
      type="button"
      title={node.label}
      onClick={() => onSelect(node.id)}
      style={{
        ...SEGMENT,
        maxWidth: node === last ? 240 : 150,
        color: node === last ? "var(--foreground)" : "var(--muted-foreground)",
        fontWeight: node === last ? 500 : 400,
      }}
    >
      {node.label}
    </button>
  );
  const separator = (key: string) => (
    <span key={key} aria-hidden style={{ color: "var(--muted-foreground)", opacity: 0.6 }}>
      /
    </span>
  );
  const parts = [...head.map(segment)];
  if (folded.length > 0)
    parts.push(
      <span key="fold" style={{ position: "relative" }}>
        <button
          type="button"
          aria-label={`${folded.length} more`}
          aria-expanded={unfolded}
          onClick={() => setUnfolded(!unfolded)}
          style={{ ...SEGMENT, padding: "0 5px", borderRadius: 4, border: "1px solid var(--border)", color: "var(--muted-foreground)" }}
        >
          …
        </button>
        {unfolded ? (
          <span
            role="menu"
            style={{
              position: "absolute",
              top: 26,
              left: 0,
              display: "flex",
              flexDirection: "column",
              gap: 2,
              padding: 4,
              minWidth: 180,
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "var(--card)",
              boxShadow: "0 8px 24px rgb(0 0 0 / 0.25)",
            }}
          >
            {folded.map((node) => (
              <button
                key={node.id}
                type="button"
                role="menuitem"
                title={node.label}
                onClick={() => {
                  setUnfolded(false);
                  onSelect(node.id);
                }}
                className="bb-canvas-action"
                style={{ ...SEGMENT, maxWidth: 280, textAlign: "left", padding: "4px 8px", borderRadius: 4, color: "var(--foreground)" }}
              >
                {node.label}
              </button>
            ))}
          </span>
        ) : null}
      </span>,
    );
  parts.push(...tail.map(segment));

  return (
    <nav
      aria-label="Breadcrumb"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        height: 30,
        padding: "0 10px",
        fontSize: 12,
        minWidth: 0,
        borderRadius: 8,
        border: "1px solid var(--border)",
        background: "color-mix(in srgb, var(--card) 92%, transparent)",
        backdropFilter: "blur(6px)",
        boxShadow: "0 1px 3px rgb(0 0 0 / 0.12)",
      }}
    >
      {parts.flatMap((part, index) => (index === 0 ? [part] : [separator(`s${index}`), part]))}
    </nav>
  );
}
