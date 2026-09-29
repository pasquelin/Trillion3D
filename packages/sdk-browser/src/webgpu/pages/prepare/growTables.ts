import { askedTableRows, rowScratch } from './layout.ts';
import { fallbackUniform } from './pipelineFor.ts';
import { pageTableBuffer } from '../render/encodeDraws.ts';
import { zeroFlagsBuffer } from '../../visibility/shaders.ts';
import { invalidateOccluderHistory } from '../io/drops.ts';
import { deviceMade } from '../../../gpu/core/errorScope.ts';
import { pendingAll, pendingBuffers, type PendingGrowth } from '../../../gpu/core/tableGrowth.ts';
import { UNIFORM_STRIDE } from '../../blend/uniforms.ts';
import { PAGE_INFO_STRIDE } from '../../../visibility/buffer.ts';
import type { TableGrowthReport } from '../../../residency/pools.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';

/** The rows the tables ask for a pool of `slots` slots, the catalogue as the layout counts it. */
export function tableRowsFor(rt: WebgpuPagesRuntime, slots: number) {
  const { layout } = rt;
  const blended = layout.packedPages.length - layout.opaquePageCount;
  const limits = rt.context.gpuDevice?.limits;
  return askedTableRows(layout.opaquePageCount, blended, slots, layout.copies.max, limits);
}

/**
 * THE TABLES SIZED BY DRAWABLE ROW GROW IN PLACE (#216), when a pool of `slots` slots — a larger
 * geometry pool (`../io/memory.ts`), placements grown in place (`../../../placement/webgpuGrowth.ts`)
 * — asks more rows than they hold. Nothing is prepared again: no shader, no pipeline, no pool, no
 * texture tile. Every GPU buffer sized by row — the page table, the zero flags, the Hi-Z verdicts,
 * the draw compact, the partition, the shadow cull and its occlusion test, the fallback uniforms —
 * is made anew beside the one it replaces, under one out-of-memory scope, while the image goes on
 * drawing from the old ones. Only once the device granted them all are they swapped in, in one
 * step between two images, with the CPU rows (`../../row/grow.ts`): every visibility row keeps its
 * rank and its page, so the image the next frame draws is the one it would have drawn, now with
 * room for the pages that waited. A refusal frees what was made and keeps every table and the pool
 * in place, said once (`gpu-out-of-memory`). Growths wait for each other, in their order; the
 * report says what the growth cost, or `null` when the tables already held what was asked.
 */
export function growWebgpuTables(rt: WebgpuPagesRuntime, slots: number) {
  const run = () => growTables(rt, slots);
  const growing = (rt.layout.growing ?? Promise.resolve()).then(run, run);
  rt.layout.growing = growing;
  return growing;
}

async function growTables(
  rt: WebgpuPagesRuntime,
  slots: number,
): Promise<TableGrowthReport | null> {
  const { layout, setup, gpu, run, diag } = rt,
    { rows } = layout;
  const started = performance.now(),
    asked = tableRowsFor(rt, slots),
    blendHeld = rows.casterSlots - rows.blendFirst;
  const drawSlots = Math.max(asked.drawSlots, rows.blendFirst),
    casterSlots = drawSlots + Math.max(asked.blendSlots, blendHeld);
  if (drawSlots === rows.blendFirst && casterSlots === rows.casterSlots) {
    setup.cap = Math.max(setup.cap, slots);
    return null;
  }
  const device = gpu.device;
  let made = pendingAll([]);
  const granted =
    device && !run.lost
      ? await deviceMade(
          device,
          () => (made = gpuGrowth(rt, device, drawSlots, casterSlots, slots)),
        )
      : made;
  if (!granted || run.lost || rt.signal.aborted) {
    granted?.destroy();
    if (!granted)
      diag.engineDiagnostic('gpu-out-of-memory', 'The device refused the grown page tables', {
        kind: 'warning',
        pool: 'page-tables',
        requestedBytes: made.bytes,
        grantedBytes: null,
      });
    const { blendFirst, casterSlots: held } = rows;
    const durationMs = performance.now() - started;
    return {
      drawSlots: blendFirst,
      casterSlots: held,
      bytes: made.bytes,
      refused: true,
      durationMs,
    };
  }
  rows.grow(drawSlots, casterSlots - drawSlots);
  Object.assign(layout, rowScratch(drawSlots, setup.pageBytes));
  granted.commit();
  follow(rt);
  setup.cap = Math.max(setup.cap, slots);
  if (asked.bounded)
    diag.engineDiagnostic('page-table-bounded', 'The device bounds the page table', {
      kind: 'warning',
      ...asked.bounded,
    });
  // Origin of the resource change: the tables the image reads were replaced.
  run.gate.resourcesChanged();
  const durationMs = performance.now() - started;
  const report = { drawSlots, casterSlots, bytes: made.bytes, refused: false, durationMs };
  diag.engineDiagnostic('page-tables-grown', 'Page tables grown in place', report);
  return report;
}

/** Every GPU table sized by row, made for `drawSlots` visibility rows and `casterSlots` rows in
 *  all, and the fallback uniforms for a pool of `slots` slots: each only where the session has
 *  the table, committed in the order the later ones read the earlier. */
function gpuGrowth(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  drawSlots: number,
  casterSlots: number,
  slots: number,
) {
  const { vis, lights, gpu } = rt,
    pageTable = rt.layout.rows.pageTableFloats;
  const uniformBytes = Math.max(1, slots) * UNIFORM_STRIDE;
  const uniform =
    gpu.uniformBuffer && gpu.uniformBuffer.size < uniformBytes
      ? fallbackUniform(device, uniformBytes)
      : undefined;
  return pendingAll([
    replaced(vis.zeroFlags && zeroFlagsBuffer(device, drawSlots), (next) => {
      const old = vis.zeroFlags;
      vis.zeroFlags = next;
      return old;
    }),
    replaced(pageTable && pageTableBuffer(device, casterSlots * PAGE_INFO_STRIDE), (next) => {
      const old = vis.pageTable;
      vis.pageTable = next;
      return old;
    }),
    replaced(uniform, (next) => {
      const old = gpu.uniformBuffer;
      gpu.uniformBuffer = next;
      gpu.uniformPacked = new Float32Array(uniformBytes / 4);
      return old;
    }),
    vis.gpuDraw?.grow(drawSlots),
    vis.gpuHiz?.growFlags(drawSlots),
    vis.gpuPartition?.grow(drawSlots, () => ({
      items: vis.gpuDraw!.itemsBuffer,
      flags: vis.gpuHiz!.flags,
      restBits: vis.gpuDraw!.restBitsBuffer,
      slotUsed: vis.gpuDraw!.slotUsedBuffer,
    })),
    lights.cull?.grow(casterSlots),
    lights.occlusion?.grow(casterSlots),
  ]);
}

/** `next`, made now, put in place by `adopt`, which returns the buffer it replaced. */
function replaced(
  next: GPUBuffer | undefined,
  adopt: (next: GPUBuffer) => GPUBuffer | undefined,
): PendingGrowth | undefined {
  return next && pendingBuffers([next], () => [adopt(next)]);
}

/** What reads the grown buffers without owning them follows them: the Hi-Z test the partition's
 *  bounds, the tested half's compaction the draw compact's lists. A page table the first image
 *  made while the growth was granted is made again at the grown size, as that image made it. The
 *  diagnostic compute raster is made again at its next image, at the new capacity; no occluder
 *  history describes the new rows. */
function follow(rt: WebgpuPagesRuntime) {
  const { vis, run } = rt,
    { gpuDraw, gpuHiz, gpuPartition } = vis,
    floats = rt.layout.rows.pageTableFloats;
  if (floats && vis.pageTable && vis.pageTable.size < floats.byteLength && rt.gpu.device) {
    vis.pageTable.destroy();
    vis.pageTable = pageTableBuffer(rt.gpu.device, floats.byteLength);
  }
  if (gpuHiz && gpuPartition) gpuHiz.attach(gpuPartition.tested, gpuPartition.state);
  if (gpuDraw && gpuHiz)
    vis.gpuRestCompact?.rebind({
      instances: gpuDraw.instanceBuffer,
      indirect: gpuDraw.indirectBuffer,
      slotOffsets: gpuDraw.slotOffsetsBuffer,
      flags: gpuHiz.flags,
    });
  vis.gpuRaster?.dispose();
  vis.gpuRaster = undefined;
  invalidateOccluderHistory(run);
}
