/**
 * THE ONE FIT OF A RASTER CHUNK'S ROWS (`rowPageBound.ts`): the most rows whose pairs and commands
 * stay within the lists' cap, counting the rows a landed histogram places by their bins
 * (`rowBoundMeasure.ts`) and every other row at the worst case — all of them where no histogram
 * speaks (`answerUnbound`).
 */
import { lastTrue } from '../../../math/src/scalar/search.ts'
import type { BoundFrame, Scratch } from './rowBoundMeasure.ts'
import type { VsmRowBound, VsmWorst } from './rowPageBound.ts'

/** The most rows ≥ `worst.rows` whose bound holds within `cap`: the tops of `sc` (the bins'), the
 *  rows no bin places counted at the worst case — every page, every command — and `frame`'s own. */
export function fit(sc: Scratch, worst: VsmWorst, candidates: number, frame: BoundFrame) {
  const [placePairs, placeCmds] = sc.unplaced
  placePairs.rows = placeCmds.rows = frame.unplaced
  placePairs.weight = worst.pages
  placeCmds.weight = worst.cmdsPerRow
  sc.tops.push(placePairs, placeCmds)
  Object.assign(sc, {
    perPairs: frame.pairs,
    perCmds: frame.cmds,
    mostPairs: worst.pages,
    mostCmds: worst.cmdsPerRow,
  })
  const { chunk } = sc
  chunk.rows = lastTrue(
    worst.rows,
    Math.max(worst.rows, candidates),
    (mid) => chunk.pairs(mid) <= worst.cap && chunk.cmds(mid) <= worst.cap,
  )
  return chunk
}

/** What a frame no histogram speaks for adds: nothing beside its rows, every one unplaced. */
const unbound: BoundFrame = { pairs: 0, cmds: 0, lamps: false, unplaced: 0, carried: false }

/** The chunk of `candidates` rows no histogram places (none landed, other rows, a sun turned):
 *  the same fit, every row at the worst case. Its answer is the scratch's: no held one stands. */
export function answerUnbound(bound: VsmRowBound, worst: VsmWorst, candidates: number) {
  const sc = bound.scratch
  bound.held = undefined
  sc.tops.length = 0
  unbound.unplaced = candidates
  return fit(sc, worst, candidates, unbound)
}
