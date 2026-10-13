import { describe, expect, it } from "vitest";
import { accentOf, STATUS_COLORS, TYPE_COLORS, typeKey } from "@/lib/kind-colors";

describe("card colours as in agent-graph (BBP-298)", () => {
  it("sorts tool calls into shell, file edit, read/search and other", () => {
    expect(typeKey({ kind: "tool-call", meta: { workKind: "command" } })).toBe("shell");
    expect(typeKey({ kind: "tool-call", meta: { workKind: "file-change" } })).toBe("edit");
    expect(typeKey({ kind: "tool-call", meta: { workKind: "search" } })).toBe("read");
    expect(typeKey({ kind: "tool-call", meta: { workKind: "file-read" } })).toBe("read");
    expect(typeKey({ kind: "tool-call", meta: { workKind: "tool" } })).toBe("other");
    expect(typeKey({ kind: "tool-call" })).toBe("other");
  });

  it("gives root and projects the project colour, threads the thread colour", () => {
    expect(typeKey({ kind: "agents" })).toBe("project");
    expect(typeKey({ kind: "project" })).toBe("project");
    expect(typeKey({ kind: "thread" })).toBe("thread");
    expect(typeKey({ kind: "subagent" })).toBe("subagent");
  });

  it("switches the accent between type and state", () => {
    const node = { kind: "thread" as const, status: "failed" as const };
    expect(accentOf(node, "type")).toBe(TYPE_COLORS.thread);
    expect(accentOf(node, "status")).toBe(STATUS_COLORS.failed);
    expect(accentOf({ kind: "thread" as const, status: "waiting" as const }, "status")).toBe(STATUS_COLORS.running);
  });
});
