// BBP-190: the canvas pulls crews (and later graph runs) from the plugins
// that know them, server-side, over each plugin's own `canvasLayer` RPC. The
// canvas knows nothing about their internals: a layer is plain bb-canvas
// nodes, edges and frames hung under the project nodes the canvas already
// draws. A plugin that is not installed, disabled or failing simply adds
// nothing — the canvas works without it.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

const loose = z.record(z.string(), z.unknown());

export const layerSchema = z.object({
  nodes: z.array(loose),
  edges: z.array(loose),
  expanded: z.array(z.string()),
  frames: z.array(loose),
});

export type ExtensionLayer = z.infer<typeof layerSchema>;

export const extensionContract = defineRpcContract({
  /** Every installed extension's layer for these projects, merged. */
  extensionLayers: {
    input: z.object({ projectIds: z.array(z.string().min(1)) }),
    output: layerSchema.extend({ sources: z.array(z.string()) }),
  },
});

/** The plugins the canvas asks, by id, with the method they answer. */
export const EXTENSIONS: readonly { pluginId: string; method: string }[] = [{ pluginId: "crew", method: "canvasLayer" }];

export type CallRpc = (pluginId: string, method: string, input: unknown) => Promise<unknown>;

const EMPTY: ExtensionLayer = { nodes: [], edges: [], expanded: [], frames: [] };

/** Asks each active extension for each project and merges the answers. A
 *  failing call costs only that extension's part. */
export async function collectLayers(
  projectIds: readonly string[],
  active: ReadonlySet<string>,
  call: CallRpc,
): Promise<ExtensionLayer & { sources: string[] }> {
  const merged: ExtensionLayer & { sources: string[] } = { ...EMPTY, nodes: [], edges: [], expanded: [], frames: [], sources: [] };
  for (const { pluginId, method } of EXTENSIONS) {
    if (!active.has(pluginId)) continue;
    const layers = await Promise.all(
      projectIds.map(async (projectId) => {
        try {
          return layerSchema.parse(await call(pluginId, method, { projectId }));
        } catch {
          return null;
        }
      }),
    );
    let answered = false;
    for (const layer of layers) {
      if (!layer) continue;
      answered = true;
      merged.nodes.push(...layer.nodes);
      merged.edges.push(...layer.edges);
      merged.expanded.push(...layer.expanded);
      merged.frames.push(...layer.frames);
    }
    if (answered) merged.sources.push(pluginId);
  }
  return merged;
}
