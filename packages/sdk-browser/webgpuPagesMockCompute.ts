import { evaluateDagSelectionKernel, type PackedDag } from './gpuDagSelection.ts';
import { DRAW_ITEM_U32, evaluateDrawCompact, indirectForDraw, type DrawItem } from './gpuDraw.ts';
import { evaluateTransparentCompaction } from './webgpuTransparentCompactCpu.ts';
import { expandBlendPlan } from './webgpuBlendExpandCpu.ts';
import { RUN_WORDS } from './webgpuBlendRuns.ts';
import { compactDrawnPages } from './webgpuPagesTestGlobals.ts';
import { residentFlags } from './gpuDagLayout.ts';

export type ComputeBind = {
  entries: Array<{ binding: number; resource: { buffer: { data: Uint8Array } } }>;
};

const words = (bytes: Uint8Array) =>
  new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);

/** Replays the transparent compaction: the same oracle the shader implements. */
function simulateTransparentCompaction(bind: ComputeBind) {
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
 * Rejoue l'étalement du plan trié : le même oracle que `BLEND_EXPAND_SHADER`, écrit une fois pour
 * les deux chemins (`webgpuBlendExpandCpu.ts`). Le double le rejoue au dernier des quatre noyaux,
 * quand toutes les entrées que la carte lirait sont là.
 */
function simulateBlendExpansion(bind: ComputeBind, offsets?: readonly number[]) {
  const byBinding = new Map(bind.entries.map((entry) => [entry.binding, entry.resource.buffer]));
  const uniBytes = byBinding.get(0)!.data;
  const uni = words(uniBytes).subarray((offsets?.[0] ?? 0) / 4);
  const plan = words(byBinding.get(1)!.data);
  // La compaction écrit un argument indirect par item paginé ; l'étalement n'en lit que le compte.
  const indirect = words(byBinding.get(4)!.data);
  const itemCounts = new Uint32Array(indirect.length / 4);
  for (let item = 0; item < itemCounts.length; item++) itemCounts[item] = indirect[item * 4 + 1];
  expandBlendPlan({
    order: plan.subarray(uni[7], uni[7] + uni[0]),
    runs: plan.subarray(uni[8], uni[8] + uni[2] * RUN_WORDS),
    runCount: uni[2],
    draws: words(byBinding.get(3)!.data),
    keep: words(byBinding.get(2)!.data),
    itemCounts,
    instances: words(byBinding.get(5)!.data),
    maxVertexWords: uni[5],
    vertexShift: uni[6],
    instanceBase: uni[3],
    argsBase: uni[4],
    expanded: words(byBinding.get(7)!.data),
    args: words(byBinding.get(8)!.data),
  });
}

export function simulateComputeDispatch(
  computePipeline: { entryPoint: string } | undefined,
  computeBind: ComputeBind | undefined,
  computes: string[],
  packed?: PackedDag,
  offsets?: readonly number[],
) {
  if (computePipeline?.entryPoint) computes.push(computePipeline.entryPoint);
  if (computePipeline?.entryPoint === 'scatterTransparentGroups' && computeBind)
    return simulateTransparentCompaction(computeBind);
  if (computePipeline?.entryPoint === 'writeBlendRuns' && computeBind)
    return simulateBlendExpansion(computeBind, offsets);
  if (computePipeline?.entryPoint === 'scatterGroups' && computeBind) {
    const byBinding = new Map(
      computeBind.entries.map((entry) => [entry.binding, entry.resource.buffer]),
    );
    const uniBytes = byBinding.get(1)!.data;
    const uni = new Uint32Array(uniBytes.buffer, uniBytes.byteOffset, uniBytes.byteLength / 4);
    const count = uni[0],
      maxVertexCount = uni[1],
      slotCap = uni[2];
    const itemBytes = byBinding.get(0)!.data;
    const itemInts = new Uint32Array(
      itemBytes.buffer,
      itemBytes.byteOffset,
      itemBytes.byteLength / 4,
    );
    const n = Math.min(count, slotCap);
    const restBytes = byBinding.get(7)!.data;
    const restInts = new Uint32Array(
      restBytes.buffer,
      restBytes.byteOffset,
      restBytes.byteLength / 4,
    );
    const restAt = (i: number) => ((restInts[i >> 5] >> (i & 31)) & 1) as 0 | 1;
    const items: DrawItem[] = [];
    for (let i = 0; i < n; i++)
      items.push({
        pageIndex: itemInts[i * DRAW_ITEM_U32],
        bin: itemInts[i * DRAW_ITEM_U32 + 1] as 0 | 1 | 2,
        rest: restAt(i),
      });
    const source =
      count > slotCap
        ? items.concat(
            Array.from({ length: count - n }, () => ({
              pageIndex: 0,
              bin: 0 as const,
              rest: 0 as const,
            })),
          )
        : items;
    const maskBytes = byBinding.get(6)?.data;
    const mask = maskBytes ? new Uint32Array(maskBytes.buffer) : undefined;
    const filtered =
      uni[4] && mask
        ? source.filter((_, i) => mask[uni[5] + itemInts[i * DRAW_ITEM_U32 + 2]] !== 0)
        : source;
    const result = evaluateDrawCompact(
      count > slotCap ? source : filtered,
      maxVertexCount,
      slotCap,
    );
    const offsets = byBinding.get(5)!.data;
    new Uint32Array(offsets.buffer).set(
      Array.from({ length: 6 }, (_, slot) => result.indirect[slot * 4 + 3]),
    );
    const instBytes = byBinding.get(2)!.data;
    new Uint32Array(instBytes.buffer, instBytes.byteOffset, instBytes.byteLength / 4).set(
      result.instances,
    );
    const indBytes = byBinding.get(3)!.data;
    new Uint32Array(indBytes.buffer, indBytes.byteOffset, indBytes.byteLength / 4).set(
      indirectForDraw(result),
    );
    return;
  }
  if (!packed || computePipeline?.entryPoint !== 'dagMask' || !computeBind) return;
  const byBinding = new Map(
    computeBind.entries.map((entry) => [entry.binding, entry.resource.buffer]),
  );
  const data = byBinding.get(2)!.data;
  const f32 = new Float32Array(data.buffer, data.byteOffset, data.byteLength / 4);
  const uniInts = new Uint32Array(data.buffer);
  const uniforms = {
    planes: f32.slice(0, 24),
    view: f32.slice(24, 40),
    pixelScale: [f32[40], f32[41]] as [number, number],
    pixelError: f32[42],
    near: f32[43],
    cameraWorld: [f32[48], f32[49], f32[50]] as [number, number, number],
    cameraStretch: f32[51],
  };
  const residentCut = !!uniInts[47];
  // La résidence vit en bits derrière les enregistrements froids : le double la relit par le
  // décodeur partagé, dans le tampon que l'hôte écrit, là où le nuanceur la lit.
  const resident = residentCut
    ? residentFlags(words(byBinding.get(8)!.data), packed.pageCount)
    : undefined;
  // Les matrices monde se lisent DANS LE TAMPON lié, là où le nuanceur les lit : l'entrée d'image
  // les y écrit ramenées à l'œil, et la vue comme les plans du même bloc d'uniformes sont de ce
  // repère-là. Une copie faite à l'empaquetage y mettrait des mondes absolus sous une vue sans
  // translation — deux repères dans une même formule, et plus une seule page retenue.
  const tampon = byBinding.get(6)!.data;
  const worlds = new Float32Array(tampon.buffer, tampon.byteOffset, packed.worlds.length);
  const result = evaluateDagSelectionKernel({ ...packed, worlds }, uniforms, resident);
  if (residentCut) {
    const flags = new Uint32Array(byBinding.get(3)!.data.buffer);
    flags.fill(0, packed.nodeCount);
    for (const id of result.drawablePageIds ?? []) flags[packed.nodeCount + id] = 1;
    // La coupe compacte ensuite ces drapeaux : le relevé ne rapporte que le compte et ses rangs.
    compactDrawnPages(
      byBinding.get(3)!.data,
      byBinding.get(4)!.data,
      packed.nodeCount,
      packed.pageCount,
    );
  }
  const out = byBinding.get(4)!.data;
  const ints = new Uint32Array(out.buffer, out.byteOffset, out.byteLength / 4);
  ints[0] = result.pageIds.length;
  ints[1] = result.frustumRejected;
  ints[2] = result.lodLevel;
  ints[3] = result.complete === false ? 2 : 0;
  ints.set(result.pageIds, 4);
}
