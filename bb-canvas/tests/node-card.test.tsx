// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NodeCard } from "@/components/NodeCard";

afterEach(cleanup);

describe("NodeCard", () => {
  it("renders the label as its accessible name", () => {
    render(<NodeCard label="orch-lead" />);
    expect(screen.getByRole("button", { name: "orch-lead" })).toBeTruthy();
  });

  it("folds the subtitle into the accessible name", () => {
    render(<NodeCard label="orch-lead" subtitle="lead" />);
    expect(screen.getByRole("button", { name: "orch-lead — lead" })).toBeTruthy();
  });

  it("calls onClick when pressed", () => {
    const onClick = vi.fn();
    render(<NodeCard label="orch-lead" onClick={onClick} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("marks itself pressed when selected", () => {
    render(<NodeCard label="orch-lead" selected />);
    expect(screen.getByRole("button").getAttribute("aria-pressed")).toBe("true");
  });

  it("shows no status dot when status is absent", () => {
    render(<NodeCard label="orch-lead" />);
    expect(screen.queryByTitle("running")).toBeNull();
  });

  it("shows a status dot with the status as its title", () => {
    render(<NodeCard label="orch-lead" status="running" />);
    expect(screen.getByTitle("running")).toBeTruthy();
  });
});

describe("NodeCard status border (BBP-146)", () => {
  it("draws a solid destructive border when failed", () => {
    render(<NodeCard label="x" status="failed" />);
    const border = screen.getByRole("button").style.border;
    expect(border).toContain("solid");
    expect(border).toContain("var(--destructive)");
  });

  it("draws a dashed amber border when waiting", () => {
    render(<NodeCard label="x" status="waiting" />);
    expect(screen.getByRole("button").getAttribute("style")).toContain("dashed");
  });

  it("draws a solid amber border when escalated", () => {
    const { container } = render(<NodeCard label="x" status="escalated" />);
    const button = container.querySelector("button")!;
    expect(button.style.border).not.toContain("dashed");
    expect(button.style.border).toContain("solid");
  });

  it("pulses while running", () => {
    render(<NodeCard label="x" status="running" />);
    expect(screen.getByRole("button").className).toContain("bb-canvas-pulse");
  });

  it("does not pulse when idle or done", () => {
    render(<NodeCard label="x" status="done" />);
    expect(screen.getByRole("button").className).not.toContain("bb-canvas-pulse");
  });

  it.each([["done", "done"], ["idle", "idle"], ["no status", undefined]] as const)(
    "negative (BBP-214 acceptance): %s produces a neutral border and no pulse",
    (_label, status) => {
      render(<NodeCard label="x" status={status} />);
      const button = screen.getByRole("button");
      expect(button.style.border).toBe("1px solid var(--border)");
      expect(button.className).not.toContain("bb-canvas-pulse");
    },
  );

  it("stays neutral regardless of kind — colour means state only (BBP-219)", () => {
    render(<NodeCard label="x" kind="member" />);
    expect(screen.getByRole("button").style.border).toContain("var(--border)");
  });

  it("shows a visible error instead of its subtitle when loadFailed is set", () => {
    render(<NodeCard label="Thread" subtitle="Thread · 3 turns" loadFailed />);
    expect(screen.getByText("Could not load activity")).toBeTruthy();
    expect(screen.queryByText("Thread · 3 turns")).toBeNull();
  });

  it("gives a failed card the destructive border regardless of kind", () => {
    render(<NodeCard label="Thread" kind="thread" loadFailed />);
    expect(screen.getByRole("button").style.border).toContain("var(--destructive)");
  });

  it("folds the error into the accessible name, so a retry click has a distinct target", () => {
    render(<NodeCard label="Thread" loadFailed />);
    expect(screen.getByRole("button", { name: "Thread — Could not load activity" })).toBeTruthy();
  });

  it("shows no error state when loadFailed is absent", () => {
    render(<NodeCard label="Thread" subtitle="Thread · 3 turns" />);
    expect(screen.queryByText("Could not load activity")).toBeNull();
  });

  it("shows a small check instead of the status dot when done, no title='done' dot", () => {
    render(<NodeCard label="x" status="done" />);
    expect(screen.queryByTitle("done")).toBeNull();
    expect(document.querySelector("svg[data-bb-done-check]")).toBeTruthy();
  });

  it("negative: no check for any other status, or no status at all", () => {
    render(
      <>
        <NodeCard label="a" status="running" />
        <NodeCard label="b" />
      </>,
    );
    expect(document.querySelector("svg[data-bb-done-check]")).toBeNull();
  });
});

describe("NodeCard group tier never borders (BBP-222)", () => {

  it("negative: a card-tier kind keeps its status border", () => {
    render(<NodeCard label="x" kind="member" status="failed" />);
    expect(screen.getByRole("button").style.border).toContain("var(--destructive)");
  });

});

describe("NodeCard three tiers (BBP-223)", () => {


  it.each(["step", "tool-call"] as const)("renders a %s row filled, with no border in the normal case", (kind) => {
    render(<NodeCard label="x" kind={kind} />);
    const button = screen.getByRole("button");
    expect(button.style.borderStyle).toBe("none");
    expect(button.style.background).toContain("var(--muted)");
  });

  it("tints a failed row's fill instead of leaving it a bare border", () => {
    render(<NodeCard label="x" kind="step" status="failed" />);
    const button = screen.getByRole("button");
    expect(button.style.border).toContain("var(--destructive)");
    expect(button.style.background).toContain("var(--destructive)");
  });

  it("ellipsizes a long label and carries the full text as a title attribute", () => {
    const long = "a".repeat(80);
    render(<NodeCard label={long} />);
    const title = screen.getByText(long);
    expect(title.style.textOverflow).toBe("ellipsis");
    expect(title.getAttribute("title")).toBe(long);
  });

  it("carries the subtitle's full text as a title attribute too", () => {
    render(<NodeCard label="x" subtitle="a very long description of this node" />);
    const sub = screen.getByText("a very long description of this node");
    expect(sub.getAttribute("title")).toBe("a very long description of this node");
  });

  it("never renders a subtitle line for a row-tier kind, even when one is given", () => {
    render(<NodeCard label="x" kind="step" subtitle="should not show" />);
    expect(screen.queryByText("should not show")).toBeNull();
  });
});

describe("NodeCard keyframes injection", () => {
  it("injects its keyframes once, no matter how many cards render", () => {
    render(
      <>
        <NodeCard label="a" status="running" />
        <NodeCard label="b" status="running" />
      </>,
    );
    expect(document.querySelectorAll("#bb-canvas-node-card-styles")).toHaveLength(1);
  });
});

describe("NodeCard status glyph and selection ring (BBP-224 design pass)", () => {
  it.each([
    ["running", "running"],
    ["failed", "failed"],
    ["waiting", "waiting"],
  ] as const)("shows a %s glyph in its state colour", (status, glyph) => {
    const { container } = render(<NodeCard label="x" kind="thread" status={status} />);
    expect(container.querySelector(`[data-bb-status-glyph="${glyph}"]`)).toBeTruthy();
  });


  it("a load failure shows the failed glyph even on a neutral status", () => {
    const { container } = render(<NodeCard label="x" kind="thread" status="idle" loadFailed />);
    expect(container.querySelector('[data-bb-status-glyph="failed"]')).toBeTruthy();
  });

  it("selection uses the --ring ink of the selected-path edge", () => {
    render(<NodeCard label="x" selected />);
    expect(screen.getByRole("button").style.outline).toContain("var(--ring)");
  });

});

describe("NodeCard root and project as cards (BBP-298)", () => {
  it.each(["agents", "project", "crew"] as const)("draws a %s like a thread card, with a border and a running pulse", (kind) => {
    render(<NodeCard label="x" kind={kind} subtitle="3 threads" status="running" />);
    const button = screen.getByRole("button");
    expect(button.style.border).toContain("var(--primary)");
    expect(button.className).toContain("bb-canvas-pulse");
    expect(screen.getByText("3 threads")).toBeTruthy();
  });
});

describe("NodeCard as a log line (BBP-298)", () => {
  it("shows the type tag, the command, the result and a duration bar", () => {
    render(<NodeCard label="npx vitest run" kind="tool-call" status="failed" log={{ tag: "shell", color: "#65a30d", detail: "exit 1", bar: 0.5 }} />);
    const row = screen.getByRole("button", { name: "npx vitest run — shell · exit 1" });
    expect(row.getAttribute("data-bb-log-row")).toBe("shell");
    expect(row.querySelector("[data-bb-duration-bar]")).toBeTruthy();
  });

  it("outlines a running line dashed blue", () => {
    render(<NodeCard label="bb plugin build" kind="tool-call" status="running" log={{ tag: "shell", color: "#65a30d", detail: "12s" }} />);
    expect(screen.getByRole("button").getAttribute("style")).toContain("dashed");
  });
});

describe("NodeCard on the active path (BBP-298)", () => {
  it("borders an idle ancestor of running work dashed blue", () => {
    render(<NodeCard label="bb-plugins" kind="project" activePath />);
    expect(screen.getByRole("button").getAttribute("style")).toContain("dashed");
  });

  it("keeps a failed card red even on the active path", () => {
    render(<NodeCard label="impl" kind="thread" status="failed" activePath />);
    expect(screen.getByRole("button").style.border).toContain("var(--destructive)");
  });
});
