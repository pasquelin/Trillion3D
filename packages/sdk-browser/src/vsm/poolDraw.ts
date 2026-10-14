import { VSM_POOL_PAGES } from './constants.ts'
import { vsmLayout, type VsmLayout, type VsmResourceOptions } from './layout.ts'
import { vsmResourceBytes } from './layoutBytes.ts'
import type { ShrunkPool } from '../residency/outOfMemory.ts'

/** The share of the pool asked that is its floor: no budget draws, and no halving goes, under it. */
const VSM_POOL_FLOOR_SHARE = 8

/** The fewest physical pages a set of `options` is drawn at: the eighth of the pages asked. */
export const vsmPoolFloor = (options: VsmResourceOptions) =>
  (options.poolPages ?? VSM_POOL_PAGES) / VSM_POOL_FLOOR_SHARE

/** A set drawn within a byte budget (`vsmPoolWithin`): its layout, and the bytes it holds. */
type VsmPool = ShrunkPool & { layout: VsmLayout }

/**
 * The set of `options` that `budgetBytes` holds, as a page pool under pressure is
 * held whole and its pages made coarser: the
 * most physical pages among `options.poolPages` (2048 by default) and its halves down to an
 * eighth whose every buffer fits (`vsmResourceBytes`); `undefined` when not even the eighth does.
 * A pool short of the pages asked is `ceiling`, `minimum` at the eighth.
 */
export function vsmPoolWithin(
  budgetBytes: number,
  options: VsmResourceOptions,
): VsmPool | undefined {
  const asked = options.poolPages ?? VSM_POOL_PAGES
  for (let pages = asked, floor = vsmPoolFloor(options); pages >= floor; pages /= 2) {
    const pool = vsmPoolAt(budgetBytes, options, pages)
    if (pool.allocatedBytes <= budgetBytes) return pool
  }
  return undefined
}

/** The set of `options` at `pages` physical pages, drawn for `budgetBytes`. */
function vsmPoolAt(budgetBytes: number, options: VsmResourceOptions, pages: number): VsmPool {
  const asked = options.poolPages ?? VSM_POOL_PAGES
  const layout = vsmLayout({ ...options, poolPages: pages })
  const clamp = pages === asked ? null : pages <= vsmPoolFloor(options) ? 'minimum' : 'ceiling'
  return { layout, budgetBytes, allocatedBytes: vsmResourceBytes(layout), clamp }
}

/** The shadow pool's draw rule, as the one halving rule reads it (`halvedPool`,
 *  `../residency/outOfMemory.ts`): the set `vsmPoolWithin` draws for a budget, and below the eighth,
 *  the eighth — the floor, which no halving goes under. */
export const vsmPoolDraw =
  (options: VsmResourceOptions) =>
  (budgetBytes: number): VsmPool =>
    vsmPoolWithin(budgetBytes, options) ?? vsmPoolAt(budgetBytes, options, vsmPoolFloor(options))
