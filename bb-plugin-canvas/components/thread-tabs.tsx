// The thread sidebar's two lists as tabs (BBP-298): "Turns" — each request
// with its steps and time — and "Tool calls" — every command and tool call
// of the newest turns. The last tab picked stays picked for the next thread.
import { useState, type ReactNode } from "react";

export type ThreadTab = "turns" | "tools";

const TAB_KEY = "bb-canvas:thread-tab";

function loadTab(): ThreadTab {
  try {
    return localStorage.getItem(TAB_KEY) === "tools" ? "tools" : "turns";
  } catch {
    return "turns";
  }
}

export function ThreadTabs({ turns, tools }: { turns: ReactNode; tools: ReactNode }) {
  const [tab, setTabState] = useState<ThreadTab>(loadTab);
  const setTab = (next: ThreadTab) => {
    try {
      localStorage.setItem(TAB_KEY, next);
    } catch {
      // Storage blocked: the pick holds for this sidebar.
    }
    setTabState(next);
  };
  const tabs: [ThreadTab, string][] = [
    ["turns", "Turns"],
    ["tools", "Tool calls"],
  ];
  return (
    <div className="flex flex-col gap-2">
      <div role="tablist" aria-label="Thread activity" className="flex gap-1 border-b border-border">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`-mb-px border-b-2 px-2 py-1 text-xs transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary ${tab === id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel">{tab === "turns" ? turns : tools}</div>
    </div>
  );
}
