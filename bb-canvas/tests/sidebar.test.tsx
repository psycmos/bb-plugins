// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { Sidebar } from "@/components/Sidebar";
import type { CanvasNode } from "@/lib/types";

afterEach(cleanup);

describe("Sidebar", () => {
  it("shows the node's label and kind", () => {
    const node: CanvasNode = { id: "m1", kind: "member", label: "orch-lead", parentId: null };
    render(<Sidebar node={node} onClose={vi.fn()} />);
    expect(screen.getByText("orch-lead")).toBeTruthy();
    expect(screen.getByText("Member")).toBeTruthy();
  });

  it("shows a status pill with the node's status, capitalized", () => {
    const node: CanvasNode = { id: "c1", kind: "crew", label: "factory-1", status: "running", parentId: null };
    render(<Sidebar node={node} onClose={vi.fn()} />);
    expect(screen.getByText("Running")).toBeTruthy();
  });

  it("shows no status pill when status is absent", () => {
    const node: CanvasNode = { id: "m1", kind: "member", label: "orch-lead", parentId: null };
    render(<Sidebar node={node} onClose={vi.fn()} />);
    expect(screen.queryByText("Idle")).toBeNull();
  });

  it("shows a crew node's curated fields, not the raw meta dump", () => {
    const node: CanvasNode = {
      id: "c1",
      kind: "crew",
      label: "factory-1",
      parentId: null,
      meta: { crew: "factory-1", status: "running" },
    };
    render(<Sidebar node={node} onClose={vi.fn()} />);
    expect(screen.getAllByText("Crew").length).toBeGreaterThan(0);
    expect(screen.getAllByText("factory-1").length).toBeGreaterThan(0);
  });

  it("puts a field the kind does not curate into the collapsed Details block", () => {
    const node: CanvasNode = {
      id: "c1",
      kind: "crew",
      label: "factory-1",
      parentId: null,
      meta: { crew: "factory-1", mystery: "x" },
    };
    render(<Sidebar node={node} onClose={vi.fn()} />);
    const details = screen.getByRole("region", { name: "Details" });
    expect(within(details).getByRole("button", { name: /Details/ }).getAttribute("aria-expanded")).toBe("false");
    expect(within(details).getByText("Mystery")).toBeTruthy();
    expect(within(details).getByText("x")).toBeTruthy();
    // The curated field must not also leak into Details.
    expect(within(details).queryByText("factory-1")).toBeNull();
  });

  it("shows no Details block when every field is curated", () => {
    const node: CanvasNode = {
      id: "c1",
      kind: "crew",
      label: "factory-1",
      parentId: null,
      meta: { crew: "factory-1" },
    };
    render(<Sidebar node={node} onClose={vi.fn()} />);
    expect(screen.queryByText("Details")).toBeNull();
  });

  it("calls onClose when its close button is pressed", () => {
    const onClose = vi.fn();
    const node: CanvasNode = { id: "m1", kind: "member", label: "orch-lead", parentId: null };
    render(<Sidebar node={node} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Close details" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("negative (BBP-199): carries the nowheel class so scrolling it does not pan the canvas", () => {
    const node: CanvasNode = { id: "m1", kind: "member", label: "orch-lead", parentId: null };
    render(<Sidebar node={node} onClose={vi.fn()} />);
    expect(screen.getByLabelText("Details for orch-lead").className).toContain("nowheel");
  });
});

describe("Sidebar long field values (BBP-206 review round 1)", () => {
  it("truncates a long curated field behind a 'more' toggle that reveals the full value", () => {
    const long = "x".repeat(300);
    const node: CanvasNode = { id: "w1", kind: "tool-call", label: "Bash", parentId: null, meta: { command: long } };
    render(<Sidebar node={node} onClose={vi.fn()} />);
    expect(screen.queryByText(long)).toBeNull();
    const more = screen.getByRole("button", { name: "more" });
    fireEvent.click(more);
    expect(screen.getByText(long)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "less" }));
    expect(screen.queryByText(long)).toBeNull();
  });

  it("shows no 'more' toggle for a short value", () => {
    const node: CanvasNode = { id: "w1", kind: "tool-call", label: "Bash", parentId: null, meta: { command: "ls -la" } };
    render(<Sidebar node={node} onClose={vi.fn()} />);
    expect(screen.getByText("ls -la")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "more" })).toBeNull();
  });

  it("truncates a long value in the collapsed Details block too", () => {
    const long = "y".repeat(300);
    const node: CanvasNode = { id: "c1", kind: "crew", label: "factory-1", parentId: null, meta: { crew: "factory-1", mystery: long } };
    render(<Sidebar node={node} onClose={vi.fn()} />);
    const details = screen.getByRole("region", { name: "Details" });
    fireEvent.click(within(details).getByRole("button", { name: /Details/ }));
    expect(within(details).queryByText(long)).toBeNull();
    fireEvent.click(within(details).getByRole("button", { name: "more" }));
    expect(within(details).getByText(long)).toBeTruthy();
  });
});

describe("Sidebar actions", () => {
  it("shows Open thread only when meta.threadId exists, and calls onOpenThread with it", () => {
    const onOpenThread = vi.fn();
    const node: CanvasNode = { id: "t1", kind: "thread", label: "Thread", parentId: null, meta: { threadId: "th1" } };
    render(<Sidebar node={node} onClose={vi.fn()} onOpenThread={onOpenThread} />);
    fireEvent.click(screen.getByRole("button", { name: "Open thread" }));
    expect(onOpenThread).toHaveBeenCalledWith("th1");
  });

  it("shows no Open thread button when meta.threadId is absent", () => {
    const node: CanvasNode = { id: "c1", kind: "crew", label: "factory-1", parentId: null };
    render(<Sidebar node={node} onClose={vi.fn()} onOpenThread={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Open thread" })).toBeNull();
  });

  it("shows Open run only when meta.runId exists, and calls onOpenRun with it", () => {
    const onOpenRun = vi.fn();
    const node: CanvasNode = { id: "r1", kind: "graph-run", label: "Run", parentId: null, meta: { runId: "run1" } };
    render(<Sidebar node={node} onClose={vi.fn()} onOpenRun={onOpenRun} />);
    fireEvent.click(screen.getByRole("button", { name: "Open run" }));
    expect(onOpenRun).toHaveBeenCalledWith("run1");
  });

  it("shows no Open run button when meta.runId is absent", () => {
    const node: CanvasNode = { id: "s1", kind: "step", label: "Step", parentId: null };
    render(<Sidebar node={node} onClose={vi.fn()} onOpenRun={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Open run" })).toBeNull();
  });

  it("shows Open crew only when meta.crew exists, and calls onOpenCrew with it", () => {
    const onOpenCrew = vi.fn();
    const node: CanvasNode = { id: "c1", kind: "crew", label: "factory-1", parentId: null, meta: { crew: "factory-1" } };
    render(<Sidebar node={node} onClose={vi.fn()} onOpenCrew={onOpenCrew} />);
    fireEvent.click(screen.getByRole("button", { name: "Open crew" }));
    expect(onOpenCrew).toHaveBeenCalledWith("factory-1");
  });

  it("shows Open in thread only when meta.threadId and meta.sourceSeq both exist, and calls onOpenAtRow with them", () => {
    const onOpenAtRow = vi.fn();
    const node: CanvasNode = {
      id: "w1",
      kind: "tool-call",
      label: "Bash",
      parentId: null,
      meta: { threadId: "th1", sourceSeq: 12 },
    };
    render(<Sidebar node={node} onClose={vi.fn()} onOpenAtRow={onOpenAtRow} />);
    fireEvent.click(screen.getByRole("button", { name: "Open in thread" }));
    expect(onOpenAtRow).toHaveBeenCalledWith("th1", 12);
  });

  it("shows no Open in thread button when meta.sourceSeq is absent", () => {
    const node: CanvasNode = {
      id: "w1",
      kind: "tool-call",
      label: "Bash",
      parentId: null,
      meta: { threadId: "th1" },
    };
    render(<Sidebar node={node} onClose={vi.fn()} onOpenAtRow={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Open in thread" })).toBeNull();
  });

  it("shows only Open in thread, not also Open thread, when the node has a row position", () => {
    const node: CanvasNode = { id: "w1", kind: "tool-call", label: "Bash", parentId: null, meta: { threadId: "th1", sourceSeq: 12 } };
    render(<Sidebar node={node} onClose={vi.fn()} onOpenThread={vi.fn()} onOpenAtRow={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Open in thread" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open thread" })).toBeNull();
  });

  it("shows Focus this for a crew/graph-run/thread node and replaces the focus with just that id (BBP-242)", () => {
    const onFocusThis = vi.fn();
    const node: CanvasNode = { id: "c1", kind: "crew", label: "factory-1", parentId: null };
    render(<Sidebar node={node} onClose={vi.fn()} onFocusThis={onFocusThis} />);
    fireEvent.click(screen.getByRole("button", { name: "Focus this" }));
    expect(onFocusThis).toHaveBeenCalledWith("c1");
  });

  it("shows Focus this for a graph-run node", () => {
    const node: CanvasNode = { id: "r1", kind: "graph-run", label: "Run", parentId: null };
    render(<Sidebar node={node} onClose={vi.fn()} onFocusThis={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Focus this" })).toBeTruthy();
  });

  it("shows Focus this for a thread node", () => {
    const node: CanvasNode = { id: "t1", kind: "thread", label: "Thread", parentId: null };
    render(<Sidebar node={node} onClose={vi.fn()} onFocusThis={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Focus this" })).toBeTruthy();
  });

  it("hides Focus this for a node kind that is not crew/graph-run/thread", () => {
    const node: CanvasNode = { id: "m1", kind: "member", label: "orch-lead", parentId: null };
    render(<Sidebar node={node} onClose={vi.fn()} onFocusThis={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Focus this" })).toBeNull();
  });

  it("hides Focus this when onFocusThis is not given", () => {
    const node: CanvasNode = { id: "c1", kind: "crew", label: "factory-1", parentId: null };
    render(<Sidebar node={node} onClose={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Focus this" })).toBeNull();
  });

  it("renders a non-zero exit code in the destructive colour and a command as code", () => {
    const node: CanvasNode = { id: "w1", kind: "tool-call", label: "Bash", parentId: null, meta: { command: "npm test", exitCode: 1 } };
    render(<Sidebar node={node} onClose={vi.fn()} />);
    expect(screen.getByText("1").closest("dd")?.getAttribute("style")).toContain("var(--destructive)");
    expect(screen.getByText("npm test").closest("code")).not.toBeNull();
  });

  it("lists a thought bundle's texts as separate items, not in Details", () => {
    const node: CanvasNode = { id: "t", kind: "system-event", label: "2 thoughts · 4.0s", parentId: null, meta: { titles: ["First idea", "Second idea"] } };
    render(<Sidebar node={node} onClose={vi.fn()} />);
    const list = screen.getByRole("region", { name: "Thoughts" });
    expect(list.querySelectorAll("li")).toHaveLength(2);
    expect(screen.queryByText("Details")).toBeNull();
  });

  it("shows no action buttons at all when no callback is given", () => {
    const node: CanvasNode = {
      id: "r1",
      kind: "graph-run",
      label: "Run",
      parentId: null,
      meta: { runId: "run1", threadId: "th1" },
    };
    render(<Sidebar node={node} onClose={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Open thread" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Open run" })).toBeNull();
  });
});

describe("Sidebar resize handle", () => {
  const node: CanvasNode = { id: "m1", kind: "member", label: "orch-lead", parentId: null };
  const width = () => Number(screen.getByRole("separator").getAttribute("aria-valuenow"));
  const aside = () => screen.getByRole("complementary") as HTMLElement;

  afterEach(() => localStorage.clear());

  it("is a vertical separator with the default width and its bounds", () => {
    render(<Sidebar node={node} onClose={vi.fn()} />);
    const handle = screen.getByRole("separator");
    expect(handle.getAttribute("aria-orientation")).toBe("vertical");
    expect(handle.getAttribute("aria-valuemin")).toBe("300");
    expect(handle.getAttribute("aria-valuemax")).toBe("640");
    expect(width()).toBe(360);
    expect(aside().style.width).toBe("360px");
  });

  it("moves 16px per arrow key; left widens because the handle sits on the left edge", () => {
    render(<Sidebar node={node} onClose={vi.fn()} />);
    fireEvent.keyDown(screen.getByRole("separator"), { key: "ArrowLeft" });
    expect(width()).toBe(376);
    fireEvent.keyDown(screen.getByRole("separator"), { key: "ArrowRight" });
    fireEvent.keyDown(screen.getByRole("separator"), { key: "ArrowRight" });
    expect(width()).toBe(344);
    expect(aside().style.width).toBe("344px");
  });

  it("jumps to the bounds with Home/End and never goes past them", () => {
    render(<Sidebar node={node} onClose={vi.fn()} />);
    const handle = screen.getByRole("separator");
    fireEvent.keyDown(handle, { key: "End" });
    fireEvent.keyDown(handle, { key: "End" });
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(width()).toBe(640);
    fireEvent.keyDown(handle, { key: "Home" });
    fireEvent.keyDown(handle, { key: "Home" });
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(width()).toBe(300);
  });

  it("ignores unrelated keys", () => {
    render(<Sidebar node={node} onClose={vi.fn()} />);
    fireEvent.keyDown(screen.getByRole("separator"), { key: "ArrowUp" });
    expect(width()).toBe(360);
  });

  it("resizes by mouse drag and clamps a drag past either edge", () => {
    render(<Sidebar node={node} onClose={vi.fn()} />);
    const handle = screen.getByRole("separator");
    fireEvent.mouseDown(handle, { clientX: 500 });
    fireEvent.mouseMove(window, { clientX: 450 });
    expect(width()).toBe(410);
    fireEvent.mouseMove(window, { clientX: -2000 });
    expect(width()).toBe(640);
    fireEvent.mouseMove(window, { clientX: 2000 });
    expect(width()).toBe(300);
    fireEvent.mouseUp(window);
    fireEvent.mouseMove(window, { clientX: 450 });
    expect(width()).toBe(300);
  });

  it("restores the persisted width after a remount", () => {
    const first = render(<Sidebar node={node} onClose={vi.fn()} />);
    fireEvent.keyDown(screen.getByRole("separator"), { key: "End" });
    expect(localStorage.getItem("bb-canvas:sidebar-width")).toBe("640");
    first.unmount();
    render(<Sidebar node={node} onClose={vi.fn()} />);
    expect(width()).toBe(640);
  });

  it("clamps an out-of-range or garbage stored width", () => {
    localStorage.setItem("bb-canvas:sidebar-width", "5000");
    const first = render(<Sidebar node={node} onClose={vi.fn()} />);
    expect(width()).toBe(640);
    first.unmount();
    localStorage.setItem("bb-canvas:sidebar-width", "wide");
    render(<Sidebar node={node} onClose={vi.fn()} />);
    expect(width()).toBe(360);
  });

  it("hides technical fields behind a collapsed Debug toggle (BBP-206 R2c)", () => {
    const node: CanvasNode = { id: "w1", kind: "tool-call", label: "Bash", parentId: null, meta: { toolName: "Bash", rowId: "r1", kind: "work" } };
    render(<Sidebar node={node} onClose={vi.fn()} />);
    expect(screen.queryByText("Details")).toBeNull();
    const debug = screen.getByRole("region", { name: "Debug" });
    expect(within(debug).getByRole("button", { name: /Debug/ }).getAttribute("aria-expanded")).toBe("false");
    expect(within(debug).getByText("r1")).toBeTruthy();
  });

  it("shows no Debug toggle without technical fields", () => {
    const node: CanvasNode = { id: "w1", kind: "tool-call", label: "Bash", parentId: null, meta: { toolName: "Bash" } };
    render(<Sidebar node={node} onClose={vi.fn()} />);
    expect(screen.queryByText("Debug")).toBeNull();
  });
});
