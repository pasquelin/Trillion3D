import { PAGE_INFO_STRIDE } from '../../visibility/buffer.ts';
import type { createDirtyRows } from './dirty.ts';
import type { createWebgpuRowState } from './state.ts';

type Rows = ReturnType<typeof createWebgpuRowState>;
const ROW_WORDS = PAGE_INFO_STRIDE / 4;

/** `from` copied into the head of `to`, the rest of `to` set to `fill`. */
export function widened<T extends Int32Array | Uint32Array>(from: T, to: T, fill: number) {
  to.set(from);
  to.fill(fill, from.length);
  return to;
}

/**
 * THE ROW TABLE GROWS IN PLACE, to `drawSlots` visibility rows and `blendSlots` casters' rows
 * behind them (`../pages/prepare/growTables.ts`). A visibility row keeps its rank, its page and its
 * words: no page moves and none is written again, so the rank allocator goes on from where it was
 * (`slots.ts`). The casters' rows now start after the new visibility rows: they are left empty
 * here and taken again at the next sync (`blendCasters.ts`), as on a new table. Every row is
 * declared dirty, so each reader of the table — the GPU page table, the draw records, the corners,
 * the spheres, the mobility words — takes its rows again, once. `generation` names the table.
 */
export function growRowState(
  rows: Rows,
  dirty: ReturnType<typeof createDirtyRows>,
  drawSlots: number,
  blendSlots: number,
) {
  const held = rows.blendFirst,
    casterSlots = drawSlots + blendSlots;
  rows.rowPageIndex = widened(rows.rowPageIndex, new Int32Array(drawSlots), -1);
  rows.rowOffsetWords = widened(rows.rowOffsetWords, new Int32Array(drawSlots), -1);
  rows.rowEpoch = widened(rows.rowEpoch, new Int32Array(drawSlots), 0);
  rows.newRowPage = new Int32Array(drawSlots);
  rows.newRowSource = new Int32Array(drawSlots);
  rows.rowRewrites = new Int32Array(drawSlots);
  rows.packedPositions.length = drawSlots;
  rows.packedPositions.fill(undefined, held);
  // The caster arrays keep their visibility rows alone: the casters' rows behind are taken again.
  rows.packedPageIndex = widened(rows.packedPageIndex.subarray(0, held), new Int32Array(casterSlots), 0);
  rows.packedRecs.length = casterSlots;
  rows.packedRecs.fill(undefined, held);
  const floats = rows.pageTableFloats;
  if (floats) {
    const grown = new Float32Array(Math.max(1, casterSlots) * ROW_WORDS);
    grown.set(floats.subarray(0, held * ROW_WORDS));
    rows.pageTableFloats = grown;
    rows.pageTableInts = new Uint32Array(grown.buffer);
  }
  rows.blendFirst = drawSlots;
  rows.casterSlots = casterSlots;
  dirty.grow(casterSlots);
  rows.markRowDirty(0, casterSlots - 1);
  rows.generation++;
}
