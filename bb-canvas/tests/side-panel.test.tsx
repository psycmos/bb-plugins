// @vitest-environment jsdom
//
// BBP-313/309: the always-open side panel — overview while nothing is
// selected, a node's view otherwise, folded away with `]` — and the breadcrumb
// island over the canvas.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { CanvasView, type OverviewContext } from "@/components/CanvasView";
import { Accordion } from "@/components/Accordion";
import { Breadcrumb, foldPath } from "@/components/Breadcrumb";
import type { CanvasNode } from "@/lib/types";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const nodes: CanvasNode[] = [
  { id: "crew", kind: "crew", label: "factory-1", parentId: null },
  { id: "m1", kind: "member", label: "orch-lead", parentId: "crew" },
  { id: "m2", kind: "member", label: "steps-impl", status: "running", parentId: "crew" },
];

function card(name: string | RegExp) {
  return screen.getByRole("button", { name });
}

function renderPanel(overview: (context: OverviewContext) => React.ReactNode = () => <p>overview body</p>, extra: Partial<Parameters<typeof CanvasView>[0]> = {}) {
  const { container } = render(<CanvasView nodes={nodes} initialExpanded={new Set(["crew"])} renderOverview={overview} {...extra} />);
  return container.querySelector("[data-canvas-view]") as HTMLElement;
}

describe("Accordion", () => {
  it("is open by default and closes on a click, with aria-expanded following", () => {
    render(
      <Accordion title="Status" summary="live">
        <p>tiles</p>
      </Accordion>,
    );
    const header = screen.getByRole("button", { name: /Status/ });
    expect(header.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("tiles").closest("[hidden]")).toBeNull();
    fireEvent.click(header);
    expect(header.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByText("tiles").closest("[hidden]")).not.toBeNull();
  });

  it("shows its summary while closed", () => {
    render(
      <Accordion title="Details" summary="3" defaultOpen={false}>
        <p>fields</p>
      </Accordion>,
    );
    expect(screen.getByRole("button", { name: /Details/ }).textContent).toContain("3");
  });

  it("remembers its state under its storage key across a remount", () => {
    const first = render(
      <Accordion title="Legend" storageKey="overview:legend">
        <p>colours</p>
      </Accordion>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Legend/ }));
    first.unmount();
    render(
      <Accordion title="Legend" storageKey="overview:legend">
        <p>colours</p>
      </Accordion>,
    );
    expect(screen.getByRole("button", { name: /Legend/ }).getAttribute("aria-expanded")).toBe("false");
  });

  it("negative: without a storage key nothing is stored and the default returns", () => {
    const first = render(
      <Accordion title="Legend">
        <p>colours</p>
      </Accordion>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Legend/ }));
    first.unmount();
    expect(localStorage.length).toBe(0);
    render(
      <Accordion title="Legend">
        <p>colours</p>
      </Accordion>,
    );
    expect(screen.getByRole("button", { name: /Legend/ }).getAttribute("aria-expanded")).toBe("true");
  });
});

describe("CanvasView side panel (BBP-313)", () => {
  it("shows the overview while nothing is selected, and no toolbar row", () => {
    renderPanel();
    expect(screen.getByRole("complementary", { name: "Overview" })).toBeTruthy();
    expect(screen.getByText("overview body")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Collapse all" })).toBeNull();
  });

  it("negative: without renderOverview the old toolbar stays and nothing shows until a selection", () => {
    render(<CanvasView nodes={nodes} initialExpanded={new Set(["crew"])} />);
    expect(screen.getByRole("button", { name: "Collapse all" })).toBeTruthy();
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("turns into the node's view on a click and back with ← Overview", () => {
    renderPanel();
    fireEvent.click(card(/^orch-lead — /));
    expect(screen.getByRole("complementary", { name: "Details for orch-lead" })).toBeTruthy();
    expect(screen.queryByText("overview body")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "← Overview" }));
    expect(screen.getByText("overview body")).toBeTruthy();
  });

  it("goes back to the overview on Escape", () => {
    const root = renderPanel();
    fireEvent.click(card(/^orch-lead — /));
    fireEvent.keyDown(root, { key: "Escape" });
    expect(screen.getByRole("complementary", { name: "Overview" })).toBeTruthy();
  });

  it("folds away with ] and the hide button, leaving a capsule that brings it back", () => {
    const root = renderPanel(undefined, { overviewBadge: <span>1 running</span> });
    fireEvent.keyDown(root, { key: "]" });
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(screen.getByText("1 running")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show panel (])" }));
    expect(screen.getByRole("complementary", { name: "Overview" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Hide panel (])" }));
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("remembers a folded panel across a remount", () => {
    const first = renderPanel();
    fireEvent.keyDown(first, { key: "]" });
    cleanup();
    renderPanel();
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("negative: ] does nothing without the panel", () => {
    const { container } = render(<CanvasView nodes={nodes} initialExpanded={new Set(["crew"])} />);
    fireEvent.keyDown(container.querySelector("[data-canvas-view]")!, { key: "]" });
    expect(localStorage.getItem("bb-canvas:panel-collapsed")).toBeNull();
  });

  it("hands the overview the expand state and the actions", () => {
    let context: OverviewContext | null = null;
    renderPanel((ctx) => {
      context = ctx;
      return <button onClick={ctx.collapseAll}>fold</button>;
    });
    expect(context!.allExpanded).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "fold" }));
    expect(context!.allExpanded).toBe(false);
  });

  it("searches: matches counted, the rest dimmed, the first match marked at once", () => {
    let context: OverviewContext | null = null;
    renderPanel((ctx) => {
      context = ctx;
      return <input aria-label="q" value={ctx.search.query} onChange={(event) => ctx.search.setQuery(event.target.value)} />;
    }, { halo: true });
    fireEvent.change(screen.getByRole("textbox", { name: "q" }), { target: { value: "steps" } });
    expect(context!.search.matches).toBe(1);
    expect(context!.search.current).toBe(1);
    expect(card(/^orch-lead — /).getAttribute("aria-disabled")).toBe("true");
    expect(card(/^steps-impl — /).getAttribute("aria-disabled")).toBe("false");
    expect(card(/^steps-impl — /).getAttribute("data-halo")).toBe("true");
  });

  it("negative: a search never selects — the panel stays on the overview", () => {
    let context: OverviewContext | null = null;
    renderPanel((ctx) => {
      context = ctx;
      return <input aria-label="q" value={ctx.search.query} onChange={(event) => ctx.search.setQuery(event.target.value)} />;
    }, { halo: true });
    fireEvent.change(screen.getByRole("textbox", { name: "q" }), { target: { value: "-" } });
    act(() => context!.search.next());
    expect(screen.getByRole("complementary", { name: "Overview" })).toBeTruthy();
    expect(card(/^orch-lead — /).getAttribute("aria-pressed")).toBe("false");
    expect(card(/^steps-impl — /).getAttribute("aria-pressed")).toBe("false");
  });

  it("steps through several matches with next and previous, wrapping at both ends", () => {
    let context: OverviewContext | null = null;
    renderPanel((ctx) => {
      context = ctx;
      return <input aria-label="q" value={ctx.search.query} onChange={(event) => ctx.search.setQuery(event.target.value)} />;
    }, { halo: true });
    fireEvent.change(screen.getByRole("textbox", { name: "q" }), { target: { value: "e" } });
    expect(context!.search.matches).toBe(2);
    expect(card(/^orch-lead — /).getAttribute("data-halo")).toBe("true");
    act(() => context!.search.next());
    expect(context!.search.current).toBe(2);
    expect(card(/^steps-impl — /).getAttribute("data-halo")).toBe("true");
    expect(card(/^orch-lead — /).getAttribute("data-halo")).toBeNull();
    act(() => context!.search.next());
    expect(context!.search.current).toBe(1);
    act(() => context!.search.previous());
    expect(context!.search.current).toBe(2);
  });

  it("negative: clearing the search drops the mark", () => {
    renderPanel((ctx) => <input aria-label="q" value={ctx.search.query} onChange={(event) => ctx.search.setQuery(event.target.value)} />, { halo: true });
    fireEvent.change(screen.getByRole("textbox", { name: "q" }), { target: { value: "steps" } });
    fireEvent.change(screen.getByRole("textbox", { name: "q" }), { target: { value: "" } });
    expect(card(/^steps-impl — /).getAttribute("data-halo")).toBeNull();
  });

  it("negative: an empty search dims nothing and counts nothing", () => {
    let context: OverviewContext | null = null;
    renderPanel((ctx) => {
      context = ctx;
      return null;
    });
    expect(context!.search.matches).toBe(0);
    expect(card(/^orch-lead — /).getAttribute("aria-disabled")).not.toBe("true");
  });

  it("pins the node footer below the sections", () => {
    renderPanel(undefined, { renderNodeFooter: (node) => <p>chat with {node.label}</p> });
    fireEvent.click(card(/^orch-lead — /));
    expect(screen.getByText("chat with orch-lead")).toBeTruthy();
  });
});

describe("Breadcrumb island (BBP-309)", () => {
  const deep: CanvasNode[] = [
    { id: "a", kind: "agents", label: "Agents", parentId: null },
    { id: "p", kind: "project", label: "bb-plugins", parentId: "a" },
    { id: "t", kind: "thread", label: "Architect", parentId: "p" },
    { id: "u", kind: "turn", label: "okay mache das", parentId: "t" },
    { id: "c", kind: "tool-call", label: "gh run watch", parentId: "u" },
  ];

  it("folds a path longer than four into first, …, last two", () => {
    expect(foldPath([1, 2, 3, 4, 5])).toEqual({ head: [1], folded: [2, 3], tail: [4, 5] });
  });

  it("negative: four segments or fewer stay unfolded", () => {
    expect(foldPath([1, 2, 3, 4])).toEqual({ head: [1, 2, 3, 4], folded: [], tail: [] });
  });

  it("shows the folded middle on a click and selects from it", () => {
    const onSelect = vi.fn();
    render(<Breadcrumb nodes={deep} selectedId="c" onSelect={onSelect} floating />);
    const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(nav).queryByText("bb-plugins")).toBeNull();
    fireEvent.click(within(nav).getByRole("button", { name: "2 more" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "bb-plugins" }));
    expect(onSelect).toHaveBeenCalledWith("p");
  });

  it("gives every segment its full label as a tooltip", () => {
    render(<Breadcrumb nodes={deep} selectedId="c" onSelect={vi.fn()} floating />);
    expect(screen.getByRole("button", { name: "gh run watch" }).getAttribute("title")).toBe("gh run watch");
  });

  it("sits over the canvas in panel mode only while something is selected", () => {
    renderPanel();
    expect(screen.queryByRole("navigation", { name: "Breadcrumb" })).toBeNull();
    fireEvent.click(card(/^orch-lead — /));
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toBeTruthy();
  });
});

describe("CanvasView page shortcuts and canvas layer (BBP-312)", () => {
  it("runs a page shortcut for its key", () => {
    const onT = vi.fn();
    const root = renderPanel(undefined, { shortcuts: { t: onT } });
    fireEvent.keyDown(root, { key: "t" });
    expect(onT).toHaveBeenCalledOnce();
  });

  it("negative: a shortcut does not fire with a modifier, nor for a key the canvas owns", () => {
    const onKey = vi.fn();
    const root = renderPanel(undefined, { shortcuts: { t: onKey, j: onKey } });
    fireEvent.keyDown(root, { key: "t", metaKey: true });
    fireEvent.keyDown(root, { key: "j" });
    expect(onKey).not.toHaveBeenCalled();
  });

  it("negative: a key typed into a field is text, not a shortcut", () => {
    const onT = vi.fn();
    renderPanel(() => <input aria-label="field" />, { shortcuts: { t: onT } });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "field" }), { key: "t" });
    expect(onT).not.toHaveBeenCalled();
  });

  it("hands the canvas layer the nodes and the selection, and lets it select", () => {
    let selected: string | null = "unset";
    renderPanel(undefined, {
      renderCanvasLayer: ({ nodes: shown, selectedId, select }) => {
        selected = selectedId;
        return <button onClick={() => select("m1")}>{shown.length} on canvas</button>;
      },
    });
    expect(selected).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "3 on canvas" }));
    expect(selected).toBe("m1");
  });
});
