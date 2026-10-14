import { describe, expect, it } from "vitest";
import { overviewSettings, overviewSummary, overviewTree } from "../lib/overview";
import { DEFAULT_THREAD_FILTER } from "../lib/thread-filter";
import type { ThreadListItem } from "../lib/thread-tree";

const HOUR = 3_600_000;
const NOW = 100 * HOUR;

const thread = (overrides: Partial<ThreadListItem> & { id: string }): ThreadListItem => ({
  projectId: "p1",
  title: overrides.id,
  titleFallback: null,
  status: "idle",
  providerId: "claude-code",
  archivedAt: null,
  updatedAt: NOW,
  ...overrides,
});

const threadIds = (layer: ReturnType<typeof overviewTree>) =>
  layer.nodes.filter((node) => node.kind === "thread").map((node) => node.meta?.threadId);

describe("overviewTree", () => {
  it("limits threads after the project filter, newest first", () => {
    const threads = [
      thread({ id: "old", updatedAt: NOW - 3 * HOUR }),
      thread({ id: "other", projectId: "p2", updatedAt: NOW }),
      thread({ id: "new", updatedAt: NOW - HOUR }),
    ];
    const layer = overviewTree({
      projects: [],
      threads,
      filter: { ...DEFAULT_THREAD_FILTER, projectIds: ["p1"], limit: 1 },
      focusThreadId: null,
      now: NOW,
    });
    expect(threadIds(layer)).toEqual(["new"]);
  });

  it("keeps the focused thread in view although the filters drop it", () => {
    const threads = [thread({ id: "a" }), thread({ id: "gone", archivedAt: NOW - HOUR })];
    const layer = overviewTree({ projects: [], threads, filter: DEFAULT_THREAD_FILTER, focusThreadId: "gone", now: NOW });
    expect(threadIds(layer)).toEqual(["a", "gone"]);
  });
});

describe("overviewTree active only (BBP-288)", () => {
  const input = (threads: ThreadListItem[], focusThreadId: string | null = null) => ({
    projects: [],
    threads,
    filter: DEFAULT_THREAD_FILTER,
    focusThreadId,
    now: NOW,
    activeOnly: true,
  });

  it("keeps only active threads with their project path, after the other filters", () => {
    const layer = overviewTree(input([thread({ id: "run", status: "active" }), thread({ id: "idle" }), thread({ id: "gone", projectId: "p2" })]));
    expect(threadIds(layer)).toEqual(["run"]);
    expect(layer.nodes.some((node) => node.kind === "project" && node.id.includes("p2"))).toBe(false);
  });

  it("is empty when nothing runs", () => {
    expect(overviewTree(input([thread({ id: "idle" })])).nodes).toEqual([]);
  });

  it("still keeps the focused thread", () => {
    expect(threadIds(overviewTree(input([thread({ id: "run", status: "active" }), thread({ id: "idle" })], "idle")))).toEqual(["run", "idle"]);
  });
});

describe("overviewTree counts", () => {
  it("counts the threads shown against every thread the project filter lets through", () => {
    const threads = [
      thread({ id: "a", updatedAt: NOW }),
      thread({ id: "b", updatedAt: NOW - HOUR }),
      thread({ id: "stale", updatedAt: NOW - 48 * HOUR }),
      thread({ id: "other", projectId: "p2" }),
      thread({ id: "arch", archivedAt: 1 }),
    ];
    const layer = overviewTree({
      projects: [],
      threads,
      filter: { ...DEFAULT_THREAD_FILTER, projectIds: ["p1"], limit: 1 },
      focusThreadId: null,
      now: NOW,
    });
    expect({ shown: layer.shown, total: layer.total }).toEqual({ shown: 1, total: 3 });
  });
});

describe("overviewSummary", () => {
  it("names window, shown and total", () => {
    expect(overviewSummary({ ...DEFAULT_THREAD_FILTER }, 20, 73)).toBe("Last 12 h · 20 of 73");
  });

  it("leaves the window out when there is none", () => {
    expect(overviewSummary({ ...DEFAULT_THREAD_FILTER, windowMs: null }, 5, 5)).toBe("5 of 5");
  });
});

describe("overviewSettings", () => {
  it("turns plugin settings into the overview filter", () => {
    expect(overviewSettings({ windowHours: 24, maxThreads: 50, overviewTurns: 3 })).toEqual({
      windowMs: 24 * HOUR,
      limit: 50,
      turnsPerThread: 3,
    });
  });

  it("falls back to the defaults for missing or out-of-range values; limit 0 is invalid", () => {
    expect(overviewSettings({ windowHours: 0, maxThreads: 0, overviewTurns: 11 })).toEqual({
      windowMs: 12 * HOUR,
      limit: 20,
      turnsPerThread: 1,
    });
    expect(overviewSettings(undefined)).toEqual({ windowMs: 12 * HOUR, limit: 20, turnsPerThread: 1 });
  });
});

// BBP-298: a thread is idle for a blink between two turns; "Active only"
// must not drop it then, or its cards and edges flicker.
describe("Active only keeps threads that ran a moment ago", () => {
  const base = { projects: [{ id: "p1", name: "Shop" }], filter: DEFAULT_THREAD_FILTER, focusThreadId: null, now: NOW, activeOnly: true };

  it("keeps a just-idle thread named in recentlyActive", () => {
    const threads = [thread({ id: "a", status: "idle" }), thread({ id: "b", status: "idle" })];
    expect(threadIds(overviewTree({ ...base, threads, recentlyActive: new Set(["a"]) }))).toEqual(["a"]);
  });

  it("keeps it even when its last update is outside the window", () => {
    const threads = [thread({ id: "a", status: "idle", updatedAt: NOW - 48 * HOUR })];
    expect(threadIds(overviewTree({ ...base, threads, recentlyActive: new Set(["a"]) }))).toEqual(["a"]);
  });

  it("drops an idle thread that did not run recently", () => {
    const threads = [thread({ id: "a", status: "idle" })];
    expect(threadIds(overviewTree({ ...base, threads }))).toEqual([]);
  });
});
