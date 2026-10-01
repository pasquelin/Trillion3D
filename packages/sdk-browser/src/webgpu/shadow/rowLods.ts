import { rootOf } from '../../page/selection/selection.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';
import { ROW_LOD_FLOATS, writeRowLod } from './rowLodWords.ts';

/** One row's detail words per row of `casterSlots` rows, and their CPU copy. */
const rowLodBuffer = (device: GPUDevice, casterSlots: number) => ({
  buffer: device.createBuffer({
    label: 'Trillion3D shadow row detail v1',
    size: Math.max(1, casterSlots) * ROW_LOD_FLOATS * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  }),
  packed: new Float32Array(Math.max(1, casterSlots) * ROW_LOD_FLOATS),
  rows: casterSlots,
});

export type ShadowRowLods = ReturnType<typeof rowLodBuffer>;

/**
 * The detail of rows `[from, to]`, on the interval the mobility words follow (`bounds.ts`): the
 * rows the table rewrote, moved, or whose cut readiness moved. Every row once when the buffer is
 * made for a table of another size. What the GPU's own page draws choose each caster's level by,
 * per page (`freshCullWgsl.ts`).
 */
export function uploadRowLods(rt: WebgpuPagesRuntime, device: GPUDevice, from: number, to: number) {
  const { lights, layout } = rt,
    { rows, selectionRoots, placement } = layout,
    { casterSlots } = rows;
  if (!lights.rowLods || lights.rowLods.rows !== casterSlots) {
    lights.rowLods?.buffer.destroy();
    lights.rowLods = rowLodBuffer(device, casterSlots);
    from = 0;
    to = casterSlots - 1;
  }
  const { buffer, packed } = lights.rowLods,
    last = Math.min(to, casterSlots - 1),
    selection = rt.run.gpuSelection;
  if (last < from) return;
  for (let row = from; row <= last; row++) {
    const page = rows.packedPageIndex[row],
      rec = row < rows.blendFirst ? rows.packedRecs[row] : undefined,
      root = rec && rootOf(selectionRoots, placement.rootOfPacked[page]);
    const ready = selection?.isReady(page) ?? true,
      childReady = selection?.isChildReady(page) ?? true;
    writeRowLod(packed, row, rec, root, ready, childReady);
  }
  const first = from * ROW_LOD_FLOATS;
  device.queue.writeBuffer(buffer, first * 4, packed, first, (last - from + 1) * ROW_LOD_FLOATS);
}
