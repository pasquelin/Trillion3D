// The transparent kernels a fake device replays: compaction of the paged items, then expansion
// of the sorted plan, each through the CPU oracle the shader implements.
import { evaluateTransparentCompaction } from '../../../packages/sdk-browser/src/webgpu/transparent/compactCpu.ts';
import { expandBlendPlan } from '../../../packages/sdk-browser/src/webgpu/blend/expandCpu.ts';
import { EXPAND_UNI, RUN_WORDS } from '../../../packages/sdk-browser/src/webgpu/blend/runs.ts';
import type { ComputeBind } from './mockCompute.ts';

export const words = (bytes: Uint8Array) =>
  new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);

/** Replays the transparent compaction: the same oracle the shader implements. */
export function simulateTransparentCompaction(bind: ComputeBind) {
  const byBinding = new Map(bind.entries.map((entry) => [entry.binding, entry.resource.buffer]));
  const uni = words(byBinding.get(1)!.data);
  const mask = words(byBinding.get(2)!.data);
  const result = evaluateTransparentCompaction({
    entries: words(byBinding.get(0)!.data),
    itemRanges: words(byBinding.get(7)!.data),
    entryCount: uni[0],
    itemCount: uni[2],
    vertexCount: uni[4],
    selected: (cluster) => mask[uni[3] + cluster] !== 0,
  });
  words(byBinding.get(5)!.data).set(result.instances.subarray(0, uni[0]));
  words(byBinding.get(6)!.data).set(result.indirect);
}

/**
 * Replays expansion of the sorted plan: the same oracle as `BLEND_EXPAND_SHADER`, written once for
 * both paths (`webgpu/blend/expandCpu.ts`). The double replays it at the last of the four kernels,
 * when every input the GPU would read is there.
 */
export function simulateBlendExpansion(bind: ComputeBind, offsets?: readonly number[]) {
  const byBinding = new Map(bind.entries.map((entry) => [entry.binding, entry.resource.buffer]));
  const uniBytes = byBinding.get(0)!.data;
  const uni = words(uniBytes).subarray((offsets?.[0] ?? 0) / 4);
  const plan = words(byBinding.get(1)!.data);
  // Compaction writes one indirect argument per paged item; expansion reads only the count.
  const indirect = words(byBinding.get(4)!.data);
  const itemCounts = new Uint32Array(indirect.length / 4);
  for (let item = 0; item < itemCounts.length; item++) itemCounts[item] = indirect[item * 4 + 1];
  const entries = uni[EXPAND_UNI.entryCount],
    runs = uni[EXPAND_UNI.runCount];
  expandBlendPlan({
    order: plan.subarray(uni[EXPAND_UNI.orderBase], uni[EXPAND_UNI.orderBase] + entries),
    runs: plan.subarray(uni[EXPAND_UNI.runsBase], uni[EXPAND_UNI.runsBase] + runs * RUN_WORDS),
    runCount: runs,
    draws: words(byBinding.get(3)!.data),
    keep: words(byBinding.get(2)!.data),
    itemCounts,
    instances: words(byBinding.get(5)!.data),
    maxVertexWords: uni[EXPAND_UNI.maxVertexWords],
    vertexShift: uni[EXPAND_UNI.vertexShift],
    instanceBase: uni[EXPAND_UNI.instanceBase],
    argsBase: uni[EXPAND_UNI.argsBase],
    expanded: words(byBinding.get(7)!.data),
    args: words(byBinding.get(8)!.data),
  });
}
