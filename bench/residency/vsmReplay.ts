import { poolRank } from '../../packages/sdk-browser/src/gpu/pool/rank.fixture.ts'
import { POOL_RANKS } from '../../packages/sdk-browser/src/gpu/pool/rank.ts'
import { VSM_PAGE_KEEP_FRAMES } from '../../packages/sdk-browser/src/vsm/constants.ts'
import { vsmPageLevel, type VsmTrace } from './trace.ts'

/** The shadow pool's order of reuse (M2): `lru`, the exact order the GPU keeps today — pages not
 *  wanted for `VSM_PAGE_KEEP_FRAMES` first, then the least recently wanted (`vsmSortPool`) —, or
 *  `rank`, the pool rank's buckets — log2 age steps × map level — within which the GPU's order is
 *  the pages'. */
type VsmOrder = 'lru' | 'rank'

/** What an order cost over a trace: the pages drawn again a frame — a wanted page not cached —,
 *  on average and at worst, and the cached pages a frame kept beside the wanted ones, on average. */
export type VsmReplay = {
  order: VsmOrder
  pages: number
  missesPerFrame: number
  worstMisses: number
  keptPerFrame: number
}

/** The rank of a cached page `age` frames after it was last wanted, `level` its map's: one not
 *  wanted for the keep span first, as EMPTY; one wanted this frame never. */
const rankOf = (age: number, level: number) =>
  age > VSM_PAGE_KEEP_FRAMES ? POOL_RANKS : poolRank(age, level, 1)

/**
 * Replays `trace` over a physical pool of `pages` under `order`: each frame, the wanted pages
 * cached are hits; the others take a free page, else the next of the frame's order — made once,
 * at the frame's start, from the pages cached then, as the GPU sorts once a frame —, and are drawn.
 */
export function replayVsm(trace: VsmTrace, order: VsmOrder, pages: number): VsmReplay {
  const owner = new Float64Array(pages).fill(-1),
    wantedAt = new Float64Array(pages),
    cached = new Map<number, number>()
  const free = Array.from({ length: pages }, (_, p) => pages - 1 - p)
  let misses = 0,
    worst = 0,
    kept = 0
  trace.frames.forEach(({ pages: wanted }, f) => {
    const want = new Set(wanted)
    // The frame's order of reuse: cached pages this frame does not want, the first to go first.
    const candidates: { p: number; key: number }[] = []
    for (let p = 0; p < pages; p++) {
      if (owner[p] < 0 || want.has(owner[p])) continue
      const age = f - wantedAt[p]
      const key =
        order === 'lru'
          ? (age > VSM_PAGE_KEEP_FRAMES ? 2 ** 40 : 0) + age
          : rankOf(age, vsmPageLevel(owner[p]))
      candidates.push({ p, key })
    }
    candidates.sort((a, b) => b.key - a.key || a.p - b.p)
    let next = 0,
      missed = 0,
      undrawn = 0
    for (const page of wanted) {
      let p = cached.get(page)
      if (p === undefined) {
        missed++
        p = free.pop() ?? candidates[next++]?.p
        // A pool smaller than one frame's pages: the rest go undrawn, counted missed.
        if (p === undefined) {
          undrawn++
          continue
        }
        if (owner[p] >= 0) cached.delete(owner[p])
        owner[p] = page
        cached.set(page, p)
      }
      wantedAt[p] = f
    }
    misses += missed
    worst = Math.max(worst, missed)
    kept += cached.size - (want.size - undrawn)
  })
  const frames = Math.max(1, trace.frames.length)
  return {
    order,
    pages,
    missesPerFrame: misses / frames,
    worstMisses: worst,
    keptPerFrame: kept / frames,
  }
}
