import { storageBufferCap } from '../../residency/pools.ts';
import { PAGE_INFO_STRIDE, VIS_MAX_PAGES } from '../../visibility/buffer.ts';
import { pageTableRows } from './pageTableRows.ts';

/**
 * THE ROWS A VIEW IS GIVEN (#1232): Nanite's fixed visible-cluster budget
 * (`r.Nanite.MaxVisibleClusters`). The page table is sized by what a view draws, never by the
 * world's placements: a scene asks at most these rows however many times its pages are placed, and
 * only a cut that selected more raises them (`viewRowsFor`). A scene whose packed instances exceed
 * them is cut on the CPU, which claims a row for each cluster it selects and nothing more
 * (`../pages/prepare/preparePages.ts`).
 */
export const VIEW_ROWS = 1 << 18;

/** The rows a view holds once its cut selected `asked`: the power of two above them, so a growing
 *  view grows the table a few times, never once per image; within what a visibility ID names. */
export const viewRowsFor = (asked: number) =>
  Math.min(VIS_MAX_PAGES, Math.max(VIEW_ROWS, 2 ** Math.ceil(Math.log2(Math.max(1, asked)))));

/**
 * THE ROWS OF THE PAGE TABLE, bounded by the device. The visibility rows (`draw`) and the blended
 * casters' rows behind them (`blend`) are asked of the scene; past one binding the table could be
 * neither created nor bound, and nothing would draw. The table then holds what one binding holds,
 * shared between the two in the proportion asked, at least one row each side that asked one. A page
 * that finds no row stays out of the cut's residency, so its nearest resident ancestor draws it
 * (`slots.ts`): a coarser page, never a hole. `bounded` names the rows asked when the device cut them.
 */
export function boundTableRows(
  limits: Parameters<typeof storageBufferCap>[0] | undefined,
  draw: number,
  blend: number,
) {
  const held = pageTableRows(limits);
  if (draw + blend <= held) return { drawSlots: draw, blendSlots: blend, bounded: null };
  const blendSlots = blend ? Math.max(1, Math.floor((held * blend) / (draw + blend))) : 0;
  return {
    drawSlots: held - blendSlots,
    blendSlots,
    bounded: { draw, blend, rows: held, bytes: held * PAGE_INFO_STRIDE },
  };
}

/**
 * The rows a table of `held` rows grows to when `asked` (`boundTableRows`) asks more (#216): no
 * visibility row gives way, nor a caster row, and a table the device bounds stays within one
 * binding, its casters' rows taking what the binding leaves beside the visibility rows.
 */
export function grownTableRows(
  asked: ReturnType<typeof boundTableRows>,
  held: { blendFirst: number; casterSlots: number },
) {
  const drawSlots = Math.max(asked.drawSlots, held.blendFirst),
    room = asked.bounded ? asked.bounded.rows - drawSlots : Infinity;
  const blendSlots = Math.max(asked.blendSlots, held.casterSlots - held.blendFirst);
  return { drawSlots, casterSlots: drawSlots + Math.min(room, blendSlots) };
}
