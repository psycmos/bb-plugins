// The page a Playwright run drives: `CanvasView` alone, no plugin host, with
// a small fixed tree (a crew, three members, one running, a graph run with a
// back edge) — enough to exercise every key the acceptance criterion names.
import { createRoot } from "react-dom/client";
import { useState } from "react";
import { CanvasView } from "../components/CanvasView";
import { ProjectFilter } from "../components/ProjectFilter";
import { Accordion } from "../components/Accordion";
import type { CanvasEdge, CanvasNode } from "../lib/types";

const nodes: CanvasNode[] = [
  { id: "agents", kind: "agents", label: "Agents", parentId: null },
  { id: "project:p1", kind: "project", label: "bb-plugins", parentId: "agents" },
  { id: "crew:factory-1", kind: "crew", label: "factory-1", parentId: "project:p1" },
  { id: "member:orch-lead", kind: "member", label: "orch-lead", status: "running", parentId: "crew:factory-1" },
  { id: "member:steps-impl", kind: "member", label: "steps-impl", parentId: "crew:factory-1" },
  { id: "member:steps-review", kind: "member", label: "steps-review", parentId: "crew:factory-1" },
  { id: "graph-run:r1", kind: "graph-run", label: "review-flow #12", status: "running", parentId: "member:orch-lead" },
  { id: "step:r1:plan", kind: "step", label: "plan", status: "done", parentId: "graph-run:r1" },
  { id: "step:r1:impl", kind: "step", label: "impl", status: "running", parentId: "graph-run:r1" },
  { id: "step:r1:review", kind: "step", label: "review", parentId: "graph-run:r1" },
];

const edges: CanvasEdge[] = [{ from: "step:r1:review", to: "step:r1:plan", variant: "back", label: "retry" }];

const initialExpanded = new Set(["agents", "project:p1", "crew:factory-1"]);

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");
// `?width=370` narrows the canvas to the slim panel BB shows beside an open
// file tree — where the toolbar and its dropdown have to fit (BBP-179).
// Without it the canvas is 1200px but still follows a narrowed viewport,
// so the sidebar's narrow-panel cap can be tested by resizing the page.
const params = new URLSearchParams(location.search);
const widthParam = Number(params.get("width"));
// `?panel=1`: the always-open side panel (BBP-313) instead of the toolbar.
const panel = params.get("panel") === "1";
const width = widthParam > 0 ? `${widthParam}px` : "min(1200px, 100vw)";

const projects = [
  { id: "p1", name: "bb-plugins" },
  { id: "p2", name: "a-project-with-a-rather-long-name" },
];

function App() {
  const [selected, setSelected] = useState<string[]>([]);
  return (
    <div style={{ width, height: "800px" }}>
      <CanvasView
        nodes={nodes}
        edges={edges}
        initialExpanded={initialExpanded}
        toolbar={panel ? undefined : <ProjectFilter projects={projects} selected={selected} onChange={setSelected} />}
        overviewBadge={panel ? <span style={{ fontSize: 11 }}>2 running</span> : undefined}
        renderOverview={
          panel
            ? (context) => (
                <>
                  <Accordion title="Search & filter" summary="—">
                    <input
                      data-canvas-search
                      aria-label="Search nodes"
                      value={context.search.query}
                      onChange={(event) => context.search.setQuery(event.target.value)}
                    />
                    <ProjectFilter projects={projects} selected={selected} onChange={setSelected} />
                  </Accordion>
                  <Accordion title="Status" summary="live">
                    <span>{context.nodes.filter((node) => node.status === "running").length} running</span>
                  </Accordion>
                  <Accordion title="Legend" defaultOpen={false}>
                    <span>colours</span>
                  </Accordion>
                </>
              )
            : undefined
        }
        renderNodeFooter={panel ? (node) => <textarea aria-label="Message" placeholder={`Message ${node.label}…`} style={{ width: "100%" }} /> : undefined}
      />
    </div>
  );
}

createRoot(root).render(<App />);
