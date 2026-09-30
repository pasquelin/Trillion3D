import { storageBufferCap } from '../../residency/pools.ts';
import { PAGE_INFO_STRIDE } from '../../visibility/buffer.ts';

/** Rows one page table holds on this device: one storage binding of `PAGE_INFO_STRIDE`-byte rows,
 *  the table every pass binds whole (`../pages/render/encodeDraws.ts`, `ensurePageTable`). */
const pageTableRows = (limits?: Parameters<typeof storageBufferCap>[0]) =>
  Math.max(2, Math.floor(storageBufferCap(limits) / PAGE_INFO_STRIDE));

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
