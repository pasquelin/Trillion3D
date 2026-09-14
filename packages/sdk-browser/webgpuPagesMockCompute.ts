import { evaluateDagSelectionKernel, type PackedDag } from './gpuDagSelection.ts';
import { evaluateDrawCompact, indirectForDraw, type DrawItem } from './gpuDraw.ts';

export type ComputeBind = {
  entries: Array<{ binding: number; resource: { buffer: { data: Uint8Array } } }>;
};

export function simulateComputeDispatch(
  computePipeline: { entryPoint: string } | undefined,
  computeBind: ComputeBind | undefined,
  computes: string[],
  packed?: PackedDag,
) {
  if (computePipeline?.entryPoint) computes.push(computePipeline.entryPoint);
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
        pageIndex: itemInts[i * 4],
        bin: itemInts[i * 4 + 1] as 0 | 1 | 2,
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
      uni[4] && mask ? source.filter((_, i) => mask[uni[5] + itemInts[i * 4 + 2]] !== 0) : source;
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
  const cones = new Float32Array(byBinding.get(8)!.data.buffer);
  const resident = residentCut
    ? Uint32Array.from({ length: packed.pageCount }, (_, i) => cones[i * 12 + 11])
    : undefined;
  const result = evaluateDagSelectionKernel(packed, uniforms, resident);
  if (residentCut) {
    const flags = new Uint32Array(byBinding.get(3)!.data.buffer);
    flags.fill(0, packed.nodeCount);
    for (const id of result.drawablePageIds ?? []) flags[packed.nodeCount + id] = 1;
  }
  const out = byBinding.get(4)!.data;
  const ints = new Uint32Array(out.buffer, out.byteOffset, out.byteLength / 4);
  ints[0] = result.pageIds.length;
  ints[1] = result.frustumRejected;
  ints[2] = result.lodLevel;
  ints[3] = result.complete === false ? 2 : 0;
  ints.set(result.pageIds, 4);
}
