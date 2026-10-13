// @vitest-environment jsdom
// BBP-298: turns loaded for a thread leave the tree with that thread. A
// thread that "Active only" (or the overview window) drops must not leave its
// turns behind as loose roots in the first column.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CanvasView } from "@/components/CanvasView";
import type { CanvasNode } from "@/lib/types";

afterEach(cleanup);

const root: CanvasNode = { id: "agents", kind: "agents", label: "Agents", parentId: null };
const quiet: CanvasNode = { id: "thread:q", kind: "thread", label: "Quiet", parentId: "agents", meta: { threadId: "q" } };
const busy: CanvasNode = { id: "thread:b", kind: "thread", label: "Busy", status: "running", parentId: "agents", meta: { threadId: "b" } };
const loadChildren = async (node: CanvasNode) => ({
  nodes: [{ id: `turn:${node.id}`, kind: "turn" as const, label: `Turn of ${node.label}`, parentId: node.id }],
});

describe("loaded children follow their parent out of the tree", () => {
  it("drops a thread's turns when the thread leaves the node set", async () => {
    const { rerender } = render(
      <CanvasView nodes={[root, quiet, busy]} initialExpanded={new Set(["agents"])} loadChildren={loadChildren} canLoadChildren={(n) => n.kind === "thread"} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Expand Quiet" }));
    expect(await screen.findByRole("button", { name: /^Turn of Quiet/ })).toBeTruthy();
    rerender(<CanvasView nodes={[root, busy]} initialExpanded={new Set(["agents"])} loadChildren={loadChildren} canLoadChildren={(n) => n.kind === "thread"} />);
    await waitFor(() => expect(screen.queryByRole("button", { name: /^Turn of Quiet/ })).toBeNull());
    expect(screen.getByRole("button", { name: /^Busy/ })).toBeTruthy();
  });

  it("shows them again when the thread comes back", async () => {
    const view = (nodes: CanvasNode[]) => (
      <CanvasView nodes={nodes} initialExpanded={new Set(["agents"])} loadChildren={loadChildren} canLoadChildren={(n) => n.kind === "thread"} />
    );
    const { rerender } = render(view([root, quiet]));
    fireEvent.click(screen.getByRole("button", { name: "Expand Quiet" }));
    await screen.findByRole("button", { name: /^Turn of Quiet/ });
    rerender(view([root]));
    rerender(view([root, quiet]));
    expect(await screen.findByRole("button", { name: /^Turn of Quiet/ })).toBeTruthy();
  });
});
