// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";

// BBP-196 fix: the start fit must keep chasing the tree across async growth
// (restored filter + restored expanded threads/turns each arrive over
// several `loadChildren` round-trips), not just fit once against whatever
// React Flow's store happened to hold first. `fitView` itself cannot be
// observed through the DOM in jsdom (the container always measures 0x0
// here), so this wraps the real `useReactFlow` to record every `fitView`
// call instead.
const fitViewCalls: unknown[] = [];
vi.mock("@xyflow/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@xyflow/react")>();
  return {
    ...actual,
    useReactFlow: () => {
      const real = actual.useReactFlow();
      return {
        ...real,
        fitView: (options?: unknown) => {
          fitViewCalls.push(options);
          return real.fitView(options as never);
        },
      };
    },
  };
});

// jsdom never lays elements out, so clientWidth/clientHeight are always 0 —
// CanvasShell's start-fit effect (BBP-214 feedback 3 round 2) waits for a
// non-zero size on its host element before fitting, which would hang every
// test in this file that doesn't care about that gate. Scoped to this file
// only (vitest isolates test files), so it can't affect e.g. Sidebar's own
// real use of clientWidth in sidebar.test.tsx. The one describe block below
// that cares about the gate overrides this per-element.
Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, value: 800 });
Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, value: 600 });

const { CanvasShell, colorLightness, START_MIN_ZOOM, startFitOptions } = await import("@/components/CanvasShell");
const { CanvasView } = await import("@/components/CanvasView");
type CanvasEdge = import("@/lib/types").CanvasEdge;
type CanvasFrame = import("@/lib/types").CanvasFrame;
type CanvasNode = import("@/lib/types").CanvasNode;
type CanvasShellHandle = import("@/components/CanvasShell").CanvasShellHandle;

afterEach(() => {
  cleanup();
  fitViewCalls.length = 0;
});

const nodes: CanvasNode[] = [
  { id: "crew", kind: "crew", label: "factory-1", parentId: null },
  { id: "m1", kind: "member", label: "orch-lead", status: "running", parentId: "crew" },
  { id: "m2", kind: "member", label: "steps-impl", parentId: "crew" },
];

const edges: CanvasEdge[] = [{ from: "m2", to: "m1", variant: "message", label: "2" }];

describe("CanvasShell", () => {
  it("renders a card for every visible node", () => {
    render(<CanvasShell nodes={nodes} expanded={new Set(["crew"])} edges={edges} />);
    expect(screen.getByRole("button", { name: new RegExp("^orch-lead — ") })).toBeTruthy();
    expect(screen.getByRole("button", { name: new RegExp("^steps-impl — ") })).toBeTruthy();
  });

  it("hides the children of a collapsed node", () => {
    render(<CanvasShell nodes={nodes} expanded={new Set()} edges={edges} />);
    expect(screen.queryByRole("button", { name: new RegExp("^orch-lead — ") })).toBeNull();
    expect(screen.getByRole("button", { name: new RegExp("^factory-1 — ") })).toBeTruthy();
  });

  it("calls onSelect with the clicked node's id", () => {
    const onSelect = vi.fn();
    render(
      <CanvasShell nodes={nodes} expanded={new Set(["crew"])} edges={edges} onSelect={onSelect} />,
    );
    fireEvent.click(screen.getByRole("button", { name: new RegExp("^orch-lead — ") }));
    expect(onSelect).toHaveBeenCalledWith("m1", expect.anything());
  });

  it("marks the selected node pressed", () => {
    render(
      <CanvasShell nodes={nodes} expanded={new Set(["crew"])} edges={edges} selectedId="m1" />,
    );
    expect(
      screen.getByRole("button", { name: new RegExp("^orch-lead — ") }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("borders a running card by status by default", () => {
    render(<CanvasShell nodes={nodes} expanded={new Set(["crew"])} edges={edges} />);
    const card = screen.getByRole("button", { name: new RegExp("^orch-lead — ") });
    expect(card.className).toContain("bb-canvas-pulse");
  });

});

describe("CanvasShell frames (BBP-165)", () => {
  it("renders a frame's label behind its member cards", () => {
    const framedNodes: CanvasNode[] = nodes.map((node) =>
      node.id === "m1" || node.id === "m2" ? { ...node, frameId: "frame-crew" } : node,
    );
    const frames: CanvasFrame[] = [{ id: "frame-crew", parentId: null, label: "crew-frame" }];
    render(
      <CanvasShell nodes={framedNodes} expanded={new Set(["crew"])} edges={edges} frames={frames} />,
    );
    expect(screen.getByText("crew-frame")).toBeTruthy();
  });
});

describe("CanvasShell trackpad/scroll navigation (BBP-199)", () => {
  function viewportTransform(container: HTMLElement): string {
    return (container.querySelector(".react-flow__viewport") as HTMLElement).style.transform;
  }

  it("pans the viewport on a plain wheel gesture over the canvas", () => {
    const { container } = render(<CanvasShell nodes={nodes} expanded={new Set(["crew"])} edges={edges} />);
    const pane = container.querySelector(".react-flow__pane")!;
    const before = viewportTransform(container);
    fireEvent.wheel(pane, { deltaX: 0, deltaY: 100, bubbles: true });
    const after = viewportTransform(container);
    expect(after).not.toBe(before);
    // A pan changes translate, not scale.
    expect(after.match(/scale\(([^)]+)\)/)?.[1]).toBe(before.match(/scale\(([^)]+)\)/)?.[1]);
  });

  it("zooms at the pointer on Ctrl+wheel instead of panning", () => {
    const { container } = render(<CanvasShell nodes={nodes} expanded={new Set(["crew"])} edges={edges} />);
    const pane = container.querySelector(".react-flow__pane")!;
    const before = viewportTransform(container);
    fireEvent.wheel(pane, { deltaX: 0, deltaY: -100, ctrlKey: true, bubbles: true });
    const after = viewportTransform(container);
    expect(after.match(/scale\(([^)]+)\)/)?.[1]).not.toBe(before.match(/scale\(([^)]+)\)/)?.[1]);
  });

  it("negative: a wheel gesture over a node card without Ctrl/Cmd pans instead of zooming", () => {
    const { container } = render(<CanvasShell nodes={nodes} expanded={new Set(["crew"])} edges={edges} />);
    const card = screen.getByRole("button", { name: new RegExp("^orch-lead — ") });
    const before = viewportTransform(container);
    fireEvent.wheel(card, { deltaX: 0, deltaY: 100, bubbles: true });
    const after = viewportTransform(container);
    expect(after.match(/scale\(([^)]+)\)/)?.[1]).toBe(before.match(/scale\(([^)]+)\)/)?.[1]);
  });

  it("negative: scrolling over an element outside the canvas pane does not move the viewport", () => {
    const { container } = render(<CanvasShell nodes={nodes} expanded={new Set(["crew"])} edges={edges} />);
    const outside = document.createElement("div");
    outside.className = "nowheel";
    container.appendChild(outside);
    const before = viewportTransform(container);
    fireEvent.wheel(outside, { deltaX: 0, deltaY: 100, bubbles: true });
    expect(viewportTransform(container)).toBe(before);
  });
});

describe("CanvasShell Ctrl/Cmd zoom at pointer, gentle step (BBP-197 Fix 3)", () => {
  function viewport(container: HTMLElement): { x: number; y: number; scale: number } {
    const transform = (container.querySelector(".react-flow__viewport") as HTMLElement).style.transform;
    const translate = transform.match(/translate\(([^,]+)px,\s*([^)]+)px\)/)!;
    const scale = transform.match(/scale\(([^)]+)\)/)!;
    return { x: Number(translate[1]), y: Number(translate[2]), scale: Number(scale[1]) };
  }

  // The library's own Ctrl+wheel pinch path multiplies the zoom step by 10
  // only when `navigator.userAgent` contains "Mac" (its `isMacOs()` check) —
  // the 4x-per-notch bug the Concierge measured only reproduces there.
  const realUserAgent = navigator.userAgent;
  beforeEach(() => {
    Object.defineProperty(navigator, "userAgent", { value: "Macintosh", configurable: true });
  });
  afterEach(() => {
    Object.defineProperty(navigator, "userAgent", { value: realUserAgent, configurable: true });
  });

  it("zooms on Cmd(Meta)+wheel, not just Ctrl+wheel", () => {
    const { container } = render(<CanvasShell nodes={nodes} expanded={new Set(["crew"])} edges={edges} />);
    const pane = container.querySelector(".react-flow__pane")!;
    const before = viewport(container);
    fireEvent.wheel(pane, { deltaX: 0, deltaY: -100, metaKey: true, clientX: 100, clientY: 50, bubbles: true });
    const after = viewport(container);
    expect(after.scale).not.toBe(before.scale);
  });

  it("keeps the flow point under the pointer fixed across a Ctrl+wheel zoom", () => {
    const { container } = render(<CanvasShell nodes={nodes} expanded={new Set(["crew"])} edges={edges} />);
    const pane = container.querySelector(".react-flow__pane")!;
    const pointer = { clientX: 120, clientY: 80 };
    const before = viewport(container);
    const flowPointBefore = {
      x: (pointer.clientX - before.x) / before.scale,
      y: (pointer.clientY - before.y) / before.scale,
    };
    fireEvent.wheel(pane, { deltaX: 0, deltaY: -100, ctrlKey: true, ...pointer, bubbles: true });
    const after = viewport(container);
    const flowPointAfter = {
      x: (pointer.clientX - after.x) / after.scale,
      y: (pointer.clientY - after.y) / after.scale,
    };
    expect(flowPointAfter.x).toBeCloseTo(flowPointBefore.x, 5);
    expect(flowPointAfter.y).toBeCloseTo(flowPointBefore.y, 5);
  });

  it("negative: a single wheel notch is a gentle step, not a 4x jump", () => {
    const { container } = render(<CanvasShell nodes={nodes} expanded={new Set(["crew"])} edges={edges} />);
    const pane = container.querySelector(".react-flow__pane")!;
    const before = viewport(container);
    fireEvent.wheel(pane, { deltaX: 0, deltaY: 100, ctrlKey: true, clientX: 100, clientY: 50, bubbles: true });
    const after = viewport(container);
    const ratio = after.scale / before.scale;
    expect(ratio).toBeGreaterThan(0.7);
    expect(ratio).toBeLessThan(1);
  });

  it("scales a tiny trackpad-pinch delta smoothly, proportional to deltaY", () => {
    const { container } = render(<CanvasShell nodes={nodes} expanded={new Set(["crew"])} edges={edges} />);
    const pane = container.querySelector(".react-flow__pane")!;
    const before = viewport(container);
    fireEvent.wheel(pane, { deltaX: 0, deltaY: -5, ctrlKey: true, clientX: 100, clientY: 50, bubbles: true });
    const after = viewport(container);
    const ratio = after.scale / before.scale;
    expect(ratio).toBeGreaterThan(1);
    expect(ratio).toBeLessThan(1.05);
  });
});

describe("colorLightness", () => {
  it("treats a fully transparent background as unreadable, not as black", () => {
    expect(colorLightness("rgba(0, 0, 0, 0)")).toBeNull();
  });

  it("reads an opaque light background as light", () => {
    expect(colorLightness("rgb(250, 250, 250)")).toBeGreaterThan(0.5);
  });
});

describe("CanvasShell host theme", () => {
  function renderInHost(background: string) {
    const host = document.createElement("div");
    host.style.backgroundColor = background;
    document.body.appendChild(host);
    const view = render(<CanvasShell nodes={nodes} expanded={new Set(["crew"])} edges={edges} />, { container: host });
    const flow = () => view.container.querySelector(".react-flow")!;
    return { host, flow };
  }

  afterEach(() => {
    document.documentElement.className = "";
  });

  it("follows a theme switch on the document while the canvas stays mounted", async () => {
    const { host, flow } = renderInHost("rgb(255, 255, 255)");
    expect(flow().classList.contains("light")).toBe(true);
    host.style.backgroundColor = "rgb(10, 10, 10)";
    document.documentElement.className = "dark";
    await vi.waitFor(() => expect(flow().classList.contains("dark")).toBe(true));
  });

  it("negative: an unrelated attribute change on the document does not re-measure", async () => {
    const { host, flow } = renderInHost("rgb(255, 255, 255)");
    host.style.backgroundColor = "rgb(10, 10, 10)";
    document.documentElement.setAttribute("lang", "en");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(flow().classList.contains("light")).toBe(true);
    document.documentElement.removeAttribute("lang");
  });
});

describe("startFitOptions (BBP-196)", () => {
  const tree: CanvasNode[] = [
    { id: "root", kind: "agents", label: "bb", parentId: null },
    { id: "p1", kind: "project", label: "p1", parentId: "root" },
    { id: "p2", kind: "project", label: "p2", parentId: "root" },
    { id: "t1", kind: "thread", label: "t1", parentId: "p1" },
    { id: "orphan", kind: "thread", label: "orphan", parentId: "missing" },
  ];

  it("fits the roots and two levels below them (agents, projects, threads)", () => {
    const ids = startFitOptions(tree).nodes.map((n) => n.id);
    expect(ids.sort()).toEqual(["orphan", "p1", "p2", "root", "t1"]);
  });

  it("floors the zoom at a readable minimum, above the manual floor of 0.2", () => {
    const options = startFitOptions(tree);
    expect(options.minZoom).toBe(START_MIN_ZOOM);
    expect(START_MIN_ZOOM).toBeGreaterThan(0.2);
  });

  it("sets no fixed zoom: a small tree still fits larger than the floor", () => {
    const options = startFitOptions(tree) as Record<string, unknown>;
    expect(options.maxZoom).toBeUndefined();
  });

});

// BBP-196 fix: a restored project filter plus restored expanded threads/turns
// means the tree keeps growing for a while after mount — each `loadChildren`
// resolution re-centers the layout (a parent sits centered on its children).
// Regression for: the start view ended up empty because React Flow's own
// `fitView` prop fit once, against the small initial tree, and never
// refitted once the restored children arrived.
describe("CanvasShell start-view refit across async growth (BBP-196)", () => {
  const baseNodes: CanvasNode[] = [
    { id: "root", kind: "agents", label: "bb", parentId: null },
    { id: "project", kind: "project", label: "bb-plugins", parentId: "root" },
    { id: "member", kind: "member", label: "a", parentId: "project" },
    { id: "thread", kind: "thread", label: "Thread", parentId: "member", meta: { threadId: "t1" } },
  ];

  it("refits the start view once a restored thread's children arrive asynchronously", async () => {
    let resolveLoad!: (value: { nodes: CanvasNode[] }) => void;
    const loadChildren = () => new Promise<{ nodes: CanvasNode[] }>((resolve) => (resolveLoad = resolve));

    render(
      <CanvasView
        nodes={baseNodes}
        // A thread already expanded from a restored (persisted) state, like
        // `localStorage` replaying a prior session's open nodes.
        initialExpanded={new Set(["root", "project", "member", "thread"])}
        loadChildren={loadChildren}
        canLoadChildren={(node) => node.kind === "thread"}
      />,
    );

    await waitFor(() => expect(fitViewCalls.length).toBeGreaterThan(0));
    const callsBeforeLoad = fitViewCalls.length;

    resolveLoad({
      nodes: [{ id: "turn-1", kind: "turn", label: "Turn · 1 step", parentId: "thread" }],
    });

    // The restored thread's turn lands after mount — the start view must
    // chase it with another fit, not leave the camera on the pre-load tree.
    await waitFor(() => expect(fitViewCalls.length).toBeGreaterThan(callsBeforeLoad));
  });

  it("stops refitting once the user has taken the viewport into their own hands", async () => {
    const ref = createRef<CanvasShellHandle>();
    const { rerender } = render(
      <CanvasShell ref={ref} nodes={baseNodes} expanded={new Set(["root", "project", "member"])} />,
    );
    await waitFor(() => expect(fitViewCalls.length).toBeGreaterThan(0));

    ref.current!.zoomIn();
    const callsAfterInteraction = fitViewCalls.length;

    // More nodes arrive later (e.g. the user expands something else by
    // hand) — the start view must not yank a now-manually-positioned camera
    // back to the "first level" framing.
    rerender(
      <CanvasShell
        ref={ref}
        nodes={[...baseNodes, { id: "thread", kind: "thread", label: "Thread", parentId: "member" }]}
        expanded={new Set(["root", "project", "member", "thread"])}
      />,
    );
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    expect(fitViewCalls.length).toBe(callsAfterInteraction);
  });

  it("stops refitting after a Ctrl/Cmd+wheel zoom too, not just the zoomIn/zoomOut/resetView handle (BBP-197 Fix 3 x BBP-196)", async () => {
    const { container, rerender } = render(
      <CanvasShell nodes={baseNodes} expanded={new Set(["root", "project", "member"])} />,
    );
    await waitFor(() => expect(fitViewCalls.length).toBeGreaterThan(0));
    const pane = container.querySelector(".react-flow__pane")!;
    fireEvent.wheel(pane, { deltaX: 0, deltaY: -100, ctrlKey: true, clientX: 100, clientY: 50, bubbles: true });
    const callsAfterZoom = fitViewCalls.length;

    // Our own `onWheelCapture` zoom calls `flow.setViewport` directly, not a
    // gesture React Flow's `onMoveStart` observes — the start-fit effect
    // must still learn this counts as user interaction, or a later nodes
    // change refits the view right back out from under the zoom.
    rerender(
      <CanvasShell
        nodes={[...baseNodes, { id: "thread", kind: "thread", label: "Thread", parentId: "member" }]}
        expanded={new Set(["root", "project", "member", "thread"])}
      />,
    );
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    expect(fitViewCalls.length).toBe(callsAfterZoom);
  });
});

// BBP-214 feedback 3 round 2: the customer saw the start view rendered far
// too small — root off-centre, barely readable — right after a reload in a
// large (2539px-wide) window. Round 1's theory (smaller BBP-221 tier sizes
// need a higher zoom floor) was backwards: a smaller fitted bounding box
// needs *less* zoom-out, so it would bind the floor *less* often, not more
// (confirmed by reading `getViewportForBounds` in `@xyflow/system`).
//
// The real mechanism: `@xyflow/react`'s own `useResizeHandler` measures
// `domNode.offsetWidth/offsetHeight` once on mount and falls back to a
// 500x500 guess if that reads 0 — plausible right after a reload, before
// BB's own layout has given the host panel its real (here: much larger)
// size. `fitView` run against that guess bakes a zoom meant for a 500x500
// box into the viewport and nothing ever re-fits just because the container
// later resizes, so the camera is stuck looking too small/off-centre.
describe("CanvasShell start fit waits for a real host size (BBP-214 feedback 3 round 2)", () => {
  const nodes: CanvasNode[] = [
    { id: "root", kind: "agents", label: "bb", parentId: null },
    { id: "project", kind: "project", label: "bb-plugins", parentId: "root" },
  ];

  function setHostSize(host: HTMLElement, width: number, height: number) {
    Object.defineProperty(host, "clientWidth", { configurable: true, value: width });
    Object.defineProperty(host, "clientHeight", { configurable: true, value: height });
  }

  function hostOf(container: HTMLElement): HTMLElement {
    return container.querySelector(".react-flow")!.parentElement as HTMLElement;
  }

  it("does not fit while the host panel still measures 0x0, the way it can right after a reload", async () => {
    const { container } = render(<CanvasShell nodes={nodes} expanded={new Set(["root"])} />);
    setHostSize(hostOf(container), 0, 0);

    // Several frames, not just one: a real stall would otherwise slip
    // through on a single early check.
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    expect(fitViewCalls.length).toBe(0);
  });

  it("fits once the host panel reports its real size, however large", async () => {
    const { container } = render(<CanvasShell nodes={nodes} expanded={new Set(["root"])} />);
    const host = hostOf(container);
    setHostSize(host, 0, 0);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    expect(fitViewCalls.length).toBe(0);

    // The host panel settles into its real, large size — as it would once
    // BB's own layout catches up after a reload.
    setHostSize(host, 2539, 1200);
    await waitFor(() => expect(fitViewCalls.length).toBeGreaterThan(0));
  });

  it("fits immediately when the host panel already has a real size on mount, same as before", async () => {
    render(<CanvasShell nodes={nodes} expanded={new Set(["root"])} />);
    // This file's own default stub (above) gives every element a non-zero
    // size unless a test overrides it, so the gate should not add any delay
    // to the common case.
    await waitFor(() => expect(fitViewCalls.length).toBeGreaterThan(0));
  });

  // Review follow-up (round 2, 01M4SPYFVTBJ3GB42MD80N83CJ): the two tests
  // above exercise "large container starts at 0" in isolation, and the
  // BBP-196 describe block above exercises "restored state + async growth"
  // in isolation — but, because this file's own default stub gives every
  // element a non-zero size from the start, neither test ever combines a
  // host panel that starts at 0x0 with a restored `initialExpanded` plus an
  // async `loadChildren` resolving after mount. That combination is exactly
  // the customer's real scenario (a reload with previously expanded threads
  // reopening, in a large window) and is the one case the size-gate and the
  // nodes-growth-refit effects could in principle race each other on.
  it("fits once, readably and on the grown tree, when restored state finishes loading before the host panel is sized", async () => {
    let resolveLoad!: (value: { nodes: CanvasNode[] }) => void;
    const loadChildren = () => new Promise<{ nodes: CanvasNode[] }>((resolve) => (resolveLoad = resolve));
    const baseNodes: CanvasNode[] = [
      { id: "root", kind: "agents", label: "bb", parentId: null },
      { id: "project", kind: "project", label: "bb-plugins", parentId: "root" },
      { id: "member", kind: "member", label: "a", parentId: "project" },
      { id: "thread", kind: "thread", label: "Thread", parentId: "member", meta: { threadId: "t1" } },
    ];

    const { container } = render(
      <CanvasView
        nodes={baseNodes}
        // A thread already expanded from a restored (persisted) state, like
        // `localStorage` replaying a prior session's open nodes.
        initialExpanded={new Set(["root", "project", "member", "thread"])}
        loadChildren={loadChildren}
        canLoadChildren={(node) => node.kind === "thread"}
      />,
    );
    const host = hostOf(container);
    setHostSize(host, 0, 0);

    // The host panel is still 0x0 — same as a reload where BB's own layout
    // hasn't settled yet — while the restored thread's children arrive.
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    expect(fitViewCalls.length).toBe(0);

    resolveLoad({
      nodes: [{ id: "turn-1", kind: "turn", label: "Turn · 1 step", parentId: "thread" }],
    });
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    // The grown tree landed, but the host panel is still unsized — the gate
    // must still hold the fit off rather than fit against the stale 500x500
    // guess the moment it finally does get a size.
    expect(fitViewCalls.length).toBe(0);

    // The host panel settles into its real, large size — matching the
    // customer's reported window — only now, after the restored children
    // have already landed. The size-gate and the growth-refit must combine
    // rather than deadlock each other: the view still ends up fitted and
    // readable, framing root and its first level.
    setHostSize(host, 2539, 1200);
    await waitFor(() => expect(fitViewCalls.length).toBeGreaterThan(0));
    const lastCall = fitViewCalls[fitViewCalls.length - 1] as { nodes?: { id: string }[] };
    const framedIds = (lastCall.nodes ?? []).map((n) => n.id);
    expect(framedIds).toEqual(expect.arrayContaining(["root", "project"]));
  });
});

// BBP-241: a focus change (the dropdown, a Ctrl/Cmd-click, "Focus this",
// "Show all") re-fits the view the same way Expand all/Collapse all do; a
// plain live-update refresh that leaves the focus untouched must not.
describe("CanvasView focus re-fit (BBP-241)", () => {
  const focusNodes: CanvasNode[] = [
    { id: "root", kind: "agents", label: "bb", parentId: null },
    { id: "crew", kind: "crew", label: "Alpha", parentId: "root" },
  ];

  it("re-fits once focusSelected changes", async () => {
    const { rerender } = render(<CanvasView nodes={focusNodes} initialExpanded={new Set(["root"])} focusSelected={[]} />);
    await waitFor(() => expect(fitViewCalls.length).toBeGreaterThan(0));
    const before = fitViewCalls.length;
    rerender(<CanvasView nodes={focusNodes} initialExpanded={new Set(["root"])} focusSelected={["crew"]} />);
    await waitFor(() => expect(fitViewCalls.length).toBeGreaterThan(before));
  });

  it("negative: a plain live-update refresh (new node array, same focusSelected) does not re-fit", async () => {
    const { container, rerender } = render(
      <CanvasView nodes={focusNodes} initialExpanded={new Set(["root"])} focusSelected={["crew"]} />,
    );
    const root = container.querySelector("[data-canvas-view]") as HTMLElement;
    await waitFor(() => expect(fitViewCalls.length).toBeGreaterThan(0));
    // Marks the view as user-interacted, same as the growth-refit tests above
    // — otherwise CanvasShell's own start-view chase (BBP-196), still active
    // this soon after mount, would refit on the node-array change below for
    // its own unrelated reason and this test would not isolate `focusKey`.
    fireEvent.keyDown(root, { key: "+" });
    const before = fitViewCalls.length;
    rerender(<CanvasView nodes={[...focusNodes]} initialExpanded={new Set(["root"])} focusSelected={["crew"]} />);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    expect(fitViewCalls.length).toBe(before);
  });
});
