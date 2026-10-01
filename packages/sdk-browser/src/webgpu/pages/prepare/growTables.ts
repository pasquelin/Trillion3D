import { askedTableRows, rowScratch } from './layout.ts';
import { grownTableRows, viewRowsFor } from '../../row/tableRows.ts';
import { pageTableBuffer } from '../render/pageTable.ts';
import { followOcclusion } from './lightResources.ts';
import { invalidateOccluderHistory } from '../io/drops.ts';
import { deviceMade } from '../../../gpu/core/errorScope.ts';
import { pendingAll } from '../../../gpu/core/tableGrowth.ts';
import { gpuGrowth } from './growGpuTables.ts';
import { queueTableGrowth } from './growthQueue.ts';
import type { TableGrowthReport } from '../../../residency/pools.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';

/** The rows the tables ask for a pool of `slots` slots, the catalogue as the layout counts it. */
export function tableRowsFor(rt: WebgpuPagesRuntime, slots: number) {
  const { layout } = rt;
  const blended = layout.packedPages.length - layout.opaquePageCount;
  const limits = rt.context.gpuDevice?.limits;
  return askedTableRows(
    layout.opaquePageCount,
    blended,
    slots,
    layout.copies.max,
    limits,
    layout.viewRows,
  );
}

/**
 * THE CUT CLAIMS ITS ROWS (#1232). The CPU cut selected `asked` rows — its clusters and the light
 * cuts' casters behind them —, or the blended casters found none left: past the rows the view
 * holds, they rise to the rung that holds them and the table grows after them, in place, as a
 * larger pool grows it (`growWebgpuTables`). It is what the view selects that sizes the table,
 * never the placements a scene repeats its pages on, as Nanite's visible-cluster list is what its
 * cut emits. Until the growth is granted, the image draws the rows the table holds.
 */
export function followCutRows(rt: WebgpuPagesRuntime, asked: number) {
  const { layout } = rt;
  if (asked <= layout.viewRows) return;
  layout.viewRows = viewRowsFor(asked);
  growWebgpuTables(rt, rt.setup.cap).catch((error) =>
    rt.diag.diagnosticFailure('page-tables-growth-failed', error),
  );
}

/**
 * THE TABLES SIZED BY DRAWABLE ROW GROW IN PLACE (#216), when a pool of `slots` slots — a larger
 * geometry pool (`../io/memory.ts`), placements grown in place
 * (`../../../placement/webgpuGrowth.ts`) — asks more rows than they hold. Nothing is prepared
 * again: no shader, no pipeline, no pool, no texture tile. Every GPU buffer sized by row
 * (`growGpuTables.ts`) is made anew beside the one it replaces, under one out-of-memory scope,
 * while the image goes on drawing from the old ones. Only once the device granted them all are they
 * swapped in, in one step between two images, with the CPU rows (`../../row/grow.ts`): every
 * visibility row keeps its rank and its page, so the image the next frame draws is the one it would
 * have drawn, now with room for the pages that waited. A refusal frees what was made and keeps
 * every table and the pool in place, said once (`gpu-out-of-memory`). A lost device grows the CPU
 * rows alone, refusing nothing: the rebuild prepares its GPU tables at their size, and the host's
 * budget holds. Growths wait for a running prepare and for each other, in their order; the report
 * says what the growth cost, or `null` when the tables already held what was asked.
 */
export const growWebgpuTables = (rt: WebgpuPagesRuntime, slots: number) =>
  queueTableGrowth(rt, () => growTables(rt, slots));

async function growTables(
  rt: WebgpuPagesRuntime,
  slots: number,
): Promise<TableGrowthReport | null> {
  const { layout, setup, gpu, run, diag } = rt,
    { rows } = layout;
  const started = performance.now(),
    asked = tableRowsFor(rt, slots),
    { drawSlots, casterSlots } = grownTableRows(asked, rows);
  if (drawSlots === rows.blendFirst && casterSlots === rows.casterSlots) {
    setup.cap = Math.max(setup.cap, slots);
    return null;
  }
  // A lost device grows the rows alone: the rebuild makes its GPU tables from them.
  const device = run.lost ? undefined : gpu.device;
  let made = pendingAll([]);
  const granted = device
    ? await deviceMade(device, () => (made = gpuGrowth(rt, device, drawSlots, casterSlots, slots)))
    : made;
  if (!granted || rt.signal.aborted) {
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
  // Lost while the device was asked: what it granted went with it.
  const lost = run.lost;
  if (lost) granted.destroy();
  rows.grow(drawSlots, casterSlots - drawSlots);
  Object.assign(layout, rowScratch(drawSlots, setup.pageBytes));
  if (!lost) {
    granted.commit();
    follow(rt);
  }
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
  followOcclusion(rt);
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
