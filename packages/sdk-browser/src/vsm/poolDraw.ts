import { VSM_POOL_PAGES, VSM_PRESSURE_LOAD } from './constants.ts'
import { ceilDiv, floorLog2, nextPow2 } from '../../../math/src/scalar/integers.ts'
import { clamp } from '../../../math/src/scalar/reals.ts'
import { vsmLayout, type VsmLayout, type VsmResourceOptions } from './layout.ts'
import { vsmResourceBytes } from './layoutBytes.ts'
import type { ShrunkPool } from '../residency/outOfMemory.ts'

/** The share of the pool asked that is its floor: no budget draws, and no halving goes, under it. */
const VSM_POOL_FLOOR_SHARE = 8

/** The fewest physical pages a set of `options` is drawn at: the eighth of the pages asked. */
export const vsmPoolFloor = (options: VsmResourceOptions) =>
  (options.poolPages ?? VSM_POOL_PAGES) / VSM_POOL_FLOOR_SHARE

/** Declared: the drawing buffer the full pool serves, 1920 × 1080 pixels. A page is marked from the
 *  pixels that see it, the clipmap's levels follow the display's width (`planVsmFrame`): the pages
 *  a view asks grow with its pixels. Larger gives every view fewer pages to start at (the pool then
 *  grows on its fill, `vsmDemandPages`); smaller, more. */
const VSM_POOL_VIEW_PIXELS = 1920 * 1080

/** The physical pages a view of `width × height` pixels is first granted: the full pool's share of
 *  its pixels to `VSM_POOL_VIEW_PIXELS`, a power of two down, between the full pool's eighth and
 *  the full pool. */
export function vsmViewPoolPages(width: number, height: number) {
  const share = (VSM_POOL_PAGES * Math.max(1, width * height)) / VSM_POOL_VIEW_PIXELS
  const pages = 2 ** floorLog2(Math.max(1, Math.floor(share)))
  return clamp(pages, VSM_POOL_PAGES / VSM_POOL_FLOOR_SHARE, VSM_POOL_PAGES)
}

/**
 * The pages a pool of `pool` pages whose last fill left `freePages` free — negative past it — asks
 * once that fill passed the load its pressure starts at (`VSM_PRESSURE_LOAD`): the power of two
 * that holds the pages used at that load, at the resolution asked — `bias` levels coarser quarter
 * the pages a level holds, so the pages used grow by four a level —, the full pool at most. 0
 * within the load: the pool holds what the view asks.
 */
export function vsmDemandPages(pool: number, freePages: number, bias: number) {
  const used = pool - freePages
  if (used <= VSM_PRESSURE_LOAD * pool) return 0
  return Math.min(VSM_POOL_PAGES, nextPow2(ceilDiv(used * 4 ** bias, VSM_PRESSURE_LOAD)))
}

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
