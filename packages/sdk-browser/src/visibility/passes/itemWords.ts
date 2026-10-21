import { BIN_KIND, CULL_BINS, DRAW_ITEM_U32 } from '../draw/contract.ts'
import { rowKind } from '../../geometry/rows/page/pageRow.ts'
import { ROW_WORDS } from '../types.ts'
import { visBin } from '../../frame/prepare/pipelineFor.ts'
import { createDirtyRows, forEachRewrittenRun } from '../../geometry/rows/dirty.ts'
import type { GpuDraw } from '../draw/contract.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { rootOfPacked } from '../../geometry/selection/placements.ts'
import { PAGE_INFO } from '../pageInfo.ts'

/**
 * The five words of a draw record — the row, its pipeline bin, its page index in the catalogue, its
 * coplanar layer and its triangles — are properties of the ROW, not of the image; the sixth, which
 * raster draws the row, is the image's, written by the GPU (`DrawItem.raster`), and this witness
 * sends it as zero. A moving camera
 * changes none of them; only a page that arrives, leaves or changes rank does, and the row table
 * already marks those rows (`rows.forEachDirtyRun`).
 *
 * This witness therefore keeps the words from one image to the next and only accumulates, row by
 * row, the runs the GPU has not yet received. Along the way it holds the TOTAL of drawable-row
 * triangles, updated on those rows alone and on rows that enter or leave the drawable rank: that is
 * what the image submits, exactly, without any image walking the resident rows again. A cutout row
 * (`FLAG_MASK`) takes its face mode's cutout bin (plus `CULL_BINS`), a voxel row (`FLAG_VOXEL`)
 * its voxel bin (plus twice `CULL_BINS`): the compaction draws each in its own slot, whose count
 * the GPU keeps as for every other (`drawVis`).
 */
export function createDrawItemWordsHold(slots: number) {
  return {
    layerSlots: -1,
    target: undefined as GpuDraw | undefined,
    /** Rows whose words the GPU has not yet received. */
    pending: createDirtyRows(),
    /** Triangles of each row, as they entered the total. */
    triangles: new Uint32Array(Math.max(1, slots)),
    /** Sum of triangles of rows `[0, heldCount)`. */
    total: 0,
    /** Whether each row is a voxel row, as it entered `voxelRows`. */
    voxel: new Uint8Array(Math.max(1, slots)),
    /** Voxel rows of `[0, heldCount)`: the voxel slots are walked while there is one
     *  (`drawVis`). */
    voxelRows: 0,
    heldCount: 0,
  }
}

/**
 * Rewrites the words of the rows the table just declared dirty, and adds them to the rows still to
 * send. A new coplanar-layer ceiling, or a fresh compaction buffer whose bytes are not ours, ask for
 * the whole table again: in both cases what the GPU holds no longer describes anything.
 */
export function refreshDrawItemWords(
  rt: WebgpuPagesRuntime,
  layerSlots: number,
  target: GpuDraw | undefined,
) {
  const { rows, itemWordsHold: hold } = rt.layout
  // Rows that just left the drawable rank leave the total: a loop bounded by what changed, never by
  // the resident-row count.
  for (let row = rows.packedCount; row < hold.heldCount; row++) {
    hold.total -= hold.triangles[row]
    hold.triangles[row] = 0
    hold.voxelRows -= hold.voxel[row]
    hold.voxel[row] = 0
  }
  // A row that enters the drawable rank enters with its words: it is dirty, or it has just been
  // written. Rewriting it costs what the rank grew, and nothing more.
  const stale = hold.layerSlots !== layerSlots || hold.target !== target
  hold.layerSlots = layerSlots
  hold.target = target
  if (!stale) forEachRewrittenRun(rows, hold.heldCount, rt, writeRun)
  else if (rows.packedCount > 0) writeRun(rt, 0, rows.packedCount - 1)
  hold.heldCount = rows.packedCount
  return hold
}

/** Writes the words of rows `[from, to]` and marks them to send. */
function writeRun(rt: WebgpuPagesRuntime, from: number, to: number) {
  const { rows, drawItemWords, itemWordsHold: hold } = rt.layout
  const ints = rows.pageTableInts,
    layerSlots = hold.layerSlots
  for (let row = from; row <= to; row++) {
    const rec = rows.packedRecs[row]!,
      word = row * DRAW_ITEM_U32,
      rank = rootOfPacked(rt.layout.placement, rows.packedPageIndex[row])
    const cull = visBin(rec, rank, rt.layout.selectionRoots)
    drawItemWords[word] = row
    // The cutout bit `maskKeep` reads on the GPU, from the words this image uploads; a voxel row in
    // the slots whose stage traces its bricks (`vis_voxel_fs`).
    const kind = ints ? rowKind(ints, row) : BIN_KIND.OPAQUE,
      voxel = kind === BIN_KIND.VOXEL ? 1 : 0
    drawItemWords[word + 1] = cull + kind * CULL_BINS
    drawItemWords[word + 2] = rows.packedPageIndex[row]
    // The coplanar layer belongs to the table row, not to the image: it travels with the item. A
    // voxel row writes its depth, which a layer's bias would not reach: it draws on layer 0.
    drawItemWords[word + 3] = voxel ? 0 : Math.min(rec.depthLayer, layerSlots)
    hold.voxelRows += voxel - hold.voxel[row]
    hold.voxel[row] = voxel
    // Triangles the row draws are those of its page-table row — what the GPU actually draws — not
    // those the cluster declares. The draw compaction batches the row by them (`batchesOf`), and
    // the table total follows without a per-image walk.
    const triangles = ints ? ints[row * ROW_WORDS + PAGE_INFO.at.indexCount] / 3 : 0
    drawItemWords[word + 4] = triangles
    hold.total += triangles - hold.triangles[row]
    hold.triangles[row] = triangles
  }
  hold.pending.mark(from, to)
}

/** Sends the pending rows' words to the compaction, run by run, then holds nothing pending. */
export function sendDrawItemWords(rt: WebgpuPagesRuntime) {
  const { pending } = rt.layout.itemWordsHold
  pending.forEachRun(rt, sendRun)
  pending.clear()
}

function sendRun(rt: WebgpuPagesRuntime, from: number, to: number) {
  rt.vis.gpuDraw!.uploadItems(rt.layout.drawItemWords, from, to)
  rt.timing.encodeCounts.itemsUploaded += to - from + 1
}
