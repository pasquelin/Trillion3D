import { DRAW_ITEM_U32 } from '../../gpu/draw/draw.ts';
import { ROW_INDEX_WORDS } from '../row/pageRow.ts';
import { PAGE_INFO_STRIDE } from '../../visibility/buffer.ts';
import { visBin } from '../pages/prepare/pipelineFor.ts';
import { dirtyRange } from '../row/state.ts';
import type { GpuDraw } from '../../gpu/draw/draw.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';

/**
 * The five words of a draw record — the row, its pipeline bin, its page index in the catalogue, its
 * coplanar layer and its triangles — are properties of the ROW, not of the image. A moving camera
 * changes none of them; only a page that arrives, leaves or changes rank does, and the row table
 * already names that interval (`rows.dirtyFrom`, `rows.dirtyTo`).
 *
 * This witness therefore keeps the words from one image to the next and only accumulates the
 * contiguous range the GPU has not yet received. Along the way it holds the TOTAL of drawable-row
 * triangles, updated on that range alone and on rows that enter or leave the drawable rank: that is
 * what the image submits, exactly, without any image walking the resident rows again.
 */
export function createDrawItemWordsHold(slots: number) {
  return {
    layerSlots: -1,
    target: undefined as GpuDraw | undefined,
    from: 0,
    to: -1,
    /** Triangles of each row, as they entered the total. */
    triangles: new Uint32Array(Math.max(1, slots)),
    /** Sum of triangles of rows `[0, heldCount)`. */
    total: 0,
    heldCount: 0,
  };
}
export type DrawItemWordsHold = ReturnType<typeof createDrawItemWordsHold>;

/**
 * Rewrites the words of the rows the table just declared dirty, and widens the remaining upload
 * range by as much. A new coplanar-layer ceiling, or a fresh compaction buffer whose bytes are not
 * ours, ask for the whole table again: in both cases what the GPU holds no longer describes anything.
 */
export function refreshDrawItemWords(
  rt: WebgpuPagesRuntime,
  layerSlots: number,
  target: GpuDraw | undefined,
) {
  const { rows, drawItemWords, itemWordsHold: hold } = rt.layout;
  const rowWords = PAGE_INFO_STRIDE / 4,
    ints = rows.pageTableInts;
  // Rows that just left the drawable rank leave the total: a loop bounded by what changed, never by
  // the resident-row count.
  for (let row = rows.packedCount; row < hold.heldCount; row++) {
    hold.total -= hold.triangles[row];
    hold.triangles[row] = 0;
  }
  // A row that enters the drawable rank enters with its words: it is dirty, or it has just been
  // written. Widening the range to it costs what the rank grew, and nothing more.
  const stale = hold.layerSlots !== layerSlots || hold.target !== target;
  if (stale) {
    hold.layerSlots = layerSlots;
    hold.target = target;
  }
  const { from, to } = dirtyRange(rows, stale, hold.heldCount);
  for (let row = from; row <= to; row++) {
    const rec = rows.packedRecs[row]!,
      word = row * DRAW_ITEM_U32;
    drawItemWords[word] = row;
    drawItemWords[word + 1] = visBin(rec);
    drawItemWords[word + 2] = rows.packedPageIndex[row];
    // The coplanar layer belongs to the table row, not to the image: it travels with the item.
    drawItemWords[word + 3] = Math.min(rec.depthLayer, layerSlots);
    // Triangles the row draws are those of its page-table row — what the GPU actually draws — not
    // those the cluster declares. The GPU partition weighs an occlusion reject with them, and the
    // table total follows without a per-image walk.
    const triangles = ints ? ints[row * rowWords + ROW_INDEX_WORDS] / 3 : 0;
    drawItemWords[word + 4] = triangles;
    hold.total += triangles - hold.triangles[row];
    hold.triangles[row] = triangles;
  }
  hold.heldCount = rows.packedCount;
  if (to >= from) {
    hold.from = hold.to < hold.from ? from : Math.min(hold.from, from);
    hold.to = Math.max(hold.to, to);
  }
  return hold;
}

/** The range's words have just been sent: nothing is pending any more. */
export function clearDrawItemWords(hold: DrawItemWordsHold) {
  hold.from = 0;
  hold.to = -1;
}
