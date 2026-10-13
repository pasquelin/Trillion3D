/**
 * THE CHUNK A LANDED HISTOGRAM GIVES A FRAME (`rowPageBound.ts`): its suns' bins read over this
 * frame's levels around the histogram's reference (`measureKey`, `sunWeights`), its joint bins at
 * their edges, the rows it cannot place at the worst case, and the most rows whose bound holds
 * within `cap`. The answer is held while nothing it reads moved: a still frame measures nothing.
 */
import { lastTrue } from '../../../math/src/scalar/search.ts'
import { sameValues } from '../../../math/src/matrix/matrixElements.ts'
import { dotVector3Xyz, length3 } from '../../../math/src/vector/vector.ts'
import { VSM_MIPS } from './constants.ts'
import { BIN_SPAN, MEET_EDGES, PAIR_EDGES, ROOM, SIDE } from './rowBins.ts'
import type { RowBinsLanded } from './rowBinsRecord.ts'
import { Ascending, Heaviest, sunWeights, Unplaced, type Top } from './rowBoundWeights.ts'
import type { VsmChunk, VsmRowBound, VsmWorst } from './rowPageBound.ts'

/** What a frame adds to the histogram: pairs and commands every row makes beside the bins (the
 *  single-page maps', the full maps' the bins do not hold), whether the joint bins hold the full
 *  maps, the rows the histogram cannot place, and whether its moving rows are still in their bins. */
export interface BoundFrame {
  pairs: number
  cmds: number
  lamps: boolean
  unplaced: number
  carried: boolean
}

/** Numbers of the key before the levels: the worst case (4), the candidates, the frame (5), the
 *  histogram's number. */
const NUMBERS = 11

/** What `answer` keeps between frames: the key and its scratch copy, each sun's levels, the tops
 *  of the suns (two a sun), of the joint bins and of the rows not placed, the summed counts of a
 *  sun's two populations, and the chunk it answers with, valid until the bound's next answer. */
export function createScratch() {
  const sc = {
    key: new Float64Array(0),
    levels: [] as Float64Array[],
    suns: [] as [Heaviest, Heaviest][],
    joint: [new Ascending(PAIR_EDGES, 1), new Ascending(MEET_EDGES, VSM_MIPS)] as const,
    unplaced: [new Unplaced(), new Unplaced()] as const,
    counts: new Uint32Array(BIN_SPAN),
    tops: [] as Top[],
    perPairs: 0,
    perCmds: 0,
    mostPairs: 0,
    mostCmds: 0,
    chunk: undefined as unknown as VsmChunk,
  }
  sc.chunk = {
    rows: 0,
    pairs: (k) => weigh(sc, 0, k * sc.perPairs, k * sc.mostPairs, k),
    cmds: (k) => weigh(sc, 1, k * sc.perCmds, k * sc.mostCmds, k),
  }
  return sc
}
export type Scratch = ReturnType<typeof createScratch>

/** The weight of `k` rows, `f` 0 pairs, 1 commands: the tops' sum, at most `most`. */
function weigh(sc: Scratch, f: 0 | 1, sum: number, most: number, k: number) {
  for (let i = f; i < sc.tops.length; i += 2) sum += sc.tops[i].top(k)
  return Math.min(sum, most)
}

/** The key of this frame's answer: `numbers`, then each sun's levels — their reach from the
 *  histogram's reference along its axes, the f32 room of that distance, their page's width and
 *  height — written into the scratch (`Scratch.levels`). */
function measureKey(sc: Scratch, landed: RowBinsLanded, numbers: readonly number[]) {
  let size = NUMBERS
  for (let s = 0; s < landed.suns.length; s++) {
    const { clipmap, axes, ref } = landed.suns[s],
      want = clipmap.levels.length * 4
    if ((sc.levels[s]?.length ?? -1) !== want) sc.levels[s] = new Float64Array(want)
    const out = sc.levels[s]
    for (let i = 0; i < clipmap.levels.length; i++) {
      const level = clipmap.levels[i]
      const hx = 1 / Math.abs(level.viewToClip[0]),
        hy = 1 / Math.abs(level.viewToClip[5])
      const c = level.worldCentre
      const dx = c[0] - ref[0] - ref[3],
        dy = c[1] - ref[1] - ref[4],
        dz = c[2] - ref[2] - ref[5]
      const off = Math.max(
        Math.abs(dotVector3Xyz(axes, dx, dy, dz)),
        Math.abs(dotVector3Xyz(axes, dx, dy, dz, 3)),
      )
      out[i * 4] = Math.max(hx, hy) + off
      out[i * 4 + 1] = ROOM * (length3(dx, dy, dz) + Math.max(hx, hy) + off)
      out[i * 4 + 2] = (2 * hx) / SIDE
      out[i * 4 + 3] = (2 * hy) / SIDE
    }
    size += want
  }
  sc.levels.length = landed.suns.length
  const key = sc.key.length === size ? sc.key : (sc.key = new Float64Array(size))
  key.set(numbers)
  let at = NUMBERS
  for (const l of sc.levels) {
    key.set(l, at)
    at += l.length
  }
  return key
}

/** `counts` of `landed` from `at`, its moving rows' added when they are still in their bins. */
function populations(into: Uint32Array, counts: Uint32Array, at: number, n: number, both: boolean) {
  for (let i = 0; i < n; i++) into[i] = counts[at + i] + (both ? counts[at + n + i] : 0)
  return into
}

/** The most rows ≥ `worst.rows` whose bound holds within `cap`, over `landed`. */
function measure(
  sc: Scratch,
  worst: VsmWorst,
  candidates: number,
  frame: BoundFrame,
  landed: RowBinsLanded,
) {
  sc.tops.length = 0
  for (let s = 0; s < landed.suns.length; s++) {
    const counts = populations(sc.counts, landed.counts, 2 * s * BIN_SPAN, BIN_SPAN, frame.carried)
    sc.suns[s] ??= [new Heaviest(), new Heaviest()]
    sc.tops.push(...sunWeights(counts, sc.levels[s], worst.pages, sc.suns[s]))
  }
  const [pairs, meets] = sc.joint
  if (frame.lamps) {
    const at = landed.jointAt,
      n = PAIR_EDGES.length
    populations(pairs.counts, landed.counts, at, n, frame.carried)
    populations(meets.counts, landed.counts, at + 2 * n, MEET_EDGES.length, frame.carried)
    pairs.most = worst.pages
    sc.tops.push(pairs, meets)
  }
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
  // The joint bins alone fill the worst case's chunk and one row more: they cannot beat it.
  const k = worst.rows + 1
  const hopeless =
    frame.lamps &&
    (Math.min(pairs.top(k), k * worst.pages) > worst.cap ||
      Math.min(meets.top(k), k * worst.cmdsPerRow) > worst.cap)
  return { chunk, hopeless }
}

const numbers: number[] = []
/** The chunk `landed` gives the frame: the held one when nothing `measure` reads moved, else
 *  measured and held. */
export function answer(
  bound: VsmRowBound,
  worst: VsmWorst,
  candidates: number,
  frame: BoundFrame,
  landed: RowBinsLanded,
) {
  const sc = bound.scratch
  numbers.length = 0
  numbers.push(worst.rows, worst.cmdsPerRow, worst.pages, worst.cap, candidates)
  numbers.push(frame.pairs, frame.cmds, frame.lamps ? 1 : 0, frame.unplaced, frame.carried ? 1 : 0)
  numbers.push(landed.seq)
  const key = measureKey(sc, landed, numbers),
    held = bound.held
  if (held && sameValues(held.key, key)) return { chunk: held.chunk, hopeless: false }
  const measured = measure(sc, worst, candidates, frame, landed)
  // The key just measured is the held one's from now; the old one is the next frame's scratch.
  if (held) {
    sc.key = held.key
    held.key = key
    held.chunk = measured.chunk
  } else {
    bound.held = { chunk: measured.chunk, key }
    sc.key = new Float64Array(key.length)
  }
  return measured
}
