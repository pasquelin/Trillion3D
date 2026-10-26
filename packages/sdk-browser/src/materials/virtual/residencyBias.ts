import { MAX_BIAS, nextResidencyBias } from './residencyStep.ts'
import type { WebgpuTileAtlas } from './atlas/atlasTypes.ts'
import type { WebgpuTilePool } from './pool/pool.ts'

/**
 * THE RESIDENCY BIAS: while the pools cannot hold what the view reads, the textures the view looks
 * at least give up their finest levels, instead of every texture reading coarser, all alike, or a
 * pool evicting what the next image reads again. A pool whose places are mostly in use — read
 * within the clocks a use protects, or pinned — raises its pressure, one that has room lowers it,
 * each image, in proportion to the gap from `RESIDENCY_BOUND`. Pinned tails above `LOCKED_BOUND`
 * of a pool — which no bias frees — bring it back to zero. The pressure is the levels a visible
 * texture of the pool gives up on average: the pool's levels to give up, that many times its
 * visible textures, are taken from the textures by their priority — the pixels they filled in the
 * last feedback, the fewest first —, each giving up at most `MAX_BIAS` before the next one gives
 * any. A texture's share is written in its own header of the atlas's page table (`page/pageTable.ts`,
 * `setSlotBias`), where the footprint rule and the request both read it (`TileSlot.bias`). The budget
 * is untouched: the bias is what a fixed pool does with a view too large for it.
 */
/** The share of a pool's places in use: those held, less every idle place the last queue ranked,
 *  listed or past its burst — the places no pixel read within the protected clocks
 *  (`evictSortWgsl.ts`). */
const visibleShare = (pool: WebgpuTilePool) => Math.max(0, pool.resident - pool.idle()) / pool.tiles

/** The residency bias of the textures of `atlases`, followed once an image (`follow`). */
export function createResidencyBias(atlases: readonly WebgpuTileAtlas[]) {
  const pressures = new WeakMap<WebgpuTilePool, number>()
  /** The slots of each atlas written with a bias, and the bias; `spare` the map the next image fills. */
  const written = new Map<
    WebgpuTileAtlas,
    { held: Map<number, number>; spare: Map<number, number> }
  >()
  /** The visible textures' slots of each pool, emptied and refilled by each atlas of an image. */
  const visible = new Map<WebgpuTilePool, number[]>()
  return {
    /** One image: each pool's pressure steps, and its visible textures — `coverageOf` the pixels each
     *  atlas's textures filled — take their shares of it. */
    follow(coverageOf: (atlas: WebgpuTileAtlas) => ReadonlyMap<number, number>) {
      for (const atlas of atlases) {
        for (const slots of visible.values()) slots.length = 0
        for (const pool of atlas.pools)
          pressures.set(
            pool,
            nextResidencyBias(
              pressures.get(pool) ?? 0,
              visibleShare(pool),
              pool.pinned / pool.tiles,
            ),
          )
        const coverage = coverageOf(atlas)
        for (const slot of coverage.keys()) {
          if (atlas.textures[slot]?.retired) continue
          const pool = atlas.poolOf(slot)
          if (!pressures.get(pool)) continue
          const list = visible.get(pool)
          if (list) list.push(slot)
          else visible.set(pool, [slot])
        }
        let maps = written.get(atlas)
        if (!maps) written.set(atlas, (maps = { held: new Map(), spare: new Map() }))
        const next = maps.spare
        next.clear()
        for (const [pool, slots] of visible) {
          let budget = pressures.get(pool)! * slots.length
          slots.sort((a, b) => coverage.get(a)! - coverage.get(b)!)
          for (const slot of slots) {
            if (budget <= 0) break
            const bias = Math.min(MAX_BIAS, budget)
            next.set(slot, bias)
            budget -= bias
          }
        }
        for (const slot of maps.held.keys()) if (!next.has(slot)) atlas.pages.setSlotBias(slot, 0)
        for (const [slot, bias] of next) atlas.pages.setSlotBias(slot, bias)
        maps.spare = maps.held
        maps.held = next
      }
    },
  }
}
