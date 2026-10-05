import { rootOf } from '../../page/selection/selection.ts';
import { forEachDirtyRun } from '../row/dirty.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';
import { ROW_LOD_FLOATS, writeRowLod } from './rowLodWords.ts';
import { rowBufferBytes } from './rowBuffers.ts';

/** One row's detail words per row of `casterSlots` rows, and their CPU copy. */
const rowLodBuffer = (device: GPUDevice, casterSlots: number) => ({
  buffer: device.createBuffer({
    label: 'Trillion3D shadow row detail v1',
    size: rowBufferBytes(casterSlots, ROW_LOD_FLOATS),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  }),
  packed: new Float32Array(Math.max(1, casterSlots) * ROW_LOD_FLOATS),
  rows: casterSlots,
});

export type ShadowRowLods = ReturnType<typeof rowLodBuffer>;

/** Rows `[from, to]`'s detail, written then sent as one span. */
function uploadRowLodRun(rt: WebgpuPagesRuntime, from: number, to: number) {
  const { rows, selectionRoots, placement } = rt.layout,
    { buffer, packed } = rt.lights.rowLods!,
    selection = rt.run.gpuSelection;
  for (let row = from; row <= to; row++) {
    const page = rows.packedPageIndex[row],
      rec = row < rows.blendFirst ? rows.packedRecs[row] : undefined,
      root = rec && rootOf(selectionRoots, placement.rootOfPacked[page]);
    const ready = selection?.isReady(page) ?? true,
      childReady = selection?.isChildReady(page) ?? true;
    writeRowLod(packed, row, rec, root, ready, childReady);
  }
  const first = from * ROW_LOD_FLOATS;
  rt.gpu.device!.queue.writeBuffer(
    buffer,
    first * 4,
    packed,
    first,
    (to - from + 1) * ROW_LOD_FLOATS,
  );
}

/**
 * The detail of the rows the table declared dirty, run by run (`forEachDirtyRun`): the rows it
 * rewrote, moved, or whose cut readiness moved (`gpuCutStream.ts` marks them). Two models that
 * move at both ends of the table write their own rows, never the thousands of still rows between
 * them, as the cluster spheres do (`spheres.ts`). Every row once when the buffer is made for a
 * table of another size. The buffer is one of the caster rows the virtual shadow maps' raster binds
 * (`../../vsm/renderPass.ts`).
 */
export function uploadRowLods(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { lights, layout } = rt,
    { rows } = layout,
    { casterSlots } = rows;
  if (!lights.rowLods || lights.rowLods.rows !== casterSlots) {
    lights.rowLods?.buffer.destroy();
    lights.rowLods = rowLodBuffer(device, casterSlots);
    if (casterSlots > 0) uploadRowLodRun(rt, 0, casterSlots - 1);
    return;
  }
  forEachDirtyRun(
    rows.dirtyMarks,
    rows.dirtyFrom,
    Math.min(rows.dirtyTo, casterSlots - 1),
    rt,
    uploadRowLodRun,
  );
}
