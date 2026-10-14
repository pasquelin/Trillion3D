/**
 * How many caster rows a chunk of the shadow raster takes (`renderPass.ts`, `transmissionPass.ts`),
 * from where the rows are: the most K such that ANY K rows make at most `cap` (row, page) pairs and
 * `cap` commands. The candidates fill a chunk in the GPU's order, so K holds for the K rows of the
 * largest bounds — a chunk of any K never exceeds it, no list overflows, no page is missed.
 *
 * A row's pairs (`vsmRenderCull` → `vsmRenderExpand`): one per page of each command's rect, one
 * command per (view, mip) whose box the row's box meets. On a clipmap level — an orthographic
 * square of half-width hw, 128 pages a side, around its snapped centre — the row's light-space box
 * (half-extent ≤ r·√3) meets the level only when its Chebyshev distance to the centre, less that
 * half-extent, is ≤ hw, and there it spans at most ceil(2e/page) + 1 pages an axis. A row makes at
 * most one pair per physical page: at most `pages`. A local light's full map is bounded by `pages`,
 * a single-page map by its one page; a local light's rows meet at most 3 faces of a point light at
 * a positive depth, its rect ≤ 4e / (s − 2e) of NDC an axis (`rowBins.ts`).
 *
 * The rows are binned by (s, e) on the GPU (`rowBinsGpu.ts`), around a reference and along axes the
 * CPU sent, and read back a few frames late, never waited on. A frame reads the last histogram
 * landed against its own reference and axes, the levels of this frame: a level whose box reaches T
 * = hw + |centre − reference|∞ from the reference holds only rows of s ≤ T. Since that histogram's
 * frame (`../gpu/shadow/rowMotion.ts`), C rows were derived for another reason than a moving
 * placement's travel — each may reach every page: pairs(k) ≤ hist(k) + min(k, C)·pages, cmds(k) ≤
 * hist(k) + min(k, C)·cmdsPerRow —, and the moving rows, binned with their radius grown by a
 * margin, still lie in their bins while the placements went no farther than it; past it, they are
 * counted as C's. Sound by construction: no page is ever missed.
 *
 * The worst case is kept when no histogram landed yet, when it binned other rows or other spheres,
 * when a sun's axes moved since it (a sun turning keeps it until it held still and its histogram
 * landed), and for full-map lights whose keys moved (`rowBinsKeys.ts`).
 */
import { sameValues } from '../../../math/src/matrix/matrixElements.ts'
import type { RowMotion } from '../gpu/shadow/rowMotion.ts'
import { VSM_MIPS } from './constants.ts'
import type { VsmLightAllocation } from './frameSetup.ts'
import { answer, createScratch, type BoundFrame, type Scratch } from './rowBoundMeasure.ts'
import { lampKeysOf } from './rowBinsKeys.ts'
import { boundLights } from './rowBinsParams.ts'
import { frameSuns, sameSuns } from './rowBinsSuns.ts'
import { createRowBins, type RowBins } from './rowBinsRecord.ts'

/** The rows' spheres as the bound reads them: the GPU's (`lights.spheres`), and what changed in
 *  them since a frame. */
export interface VsmRowSpheres {
  motion: RowMotion
}

/** The lights as the bound reads them: a sun's clipmap, a local light's single page or its maps'
 *  projection data (`entry`). */
export type VsmBoundLight = Pick<
  VsmLightAllocation,
  'kind' | 'firstId' | 'count' | 'shouldRender'
> &
  Partial<Pick<VsmLightAllocation, 'singlePage' | 'clipmap' | 'entry'>>

/** A chunk of the raster: its rows, and the most commands and pairs any k rows make. */
export interface VsmChunk {
  rows: number
  cmds: (k: number) => number
  pairs: (k: number) => number
}

/** The worst case: `rows` a chunk, every row `cmdsPerRow` commands and every one of `pages`. */
export const vsmWorstChunk = (rows: number, cmdsPerRow: number, pages: number): VsmChunk => ({
  rows,
  cmds: (k) => k * cmdsPerRow,
  pairs: (k) => k * pages,
})

/** The worst case of a pass: rows a chunk, commands a row, pages, and the most pairs and commands
 *  a chunk's lists hold (`cap` ≥ rows · pages ≥ rows · commands). */
export interface VsmWorst {
  rows: number
  cmdsPerRow: number
  pages: number
  cap: number
}

/** A pass's bound: its histograms (`rowBinsRecord.ts`), its last answer and what it was measured
 *  from, and what `answer` reuses so a frame allocates nothing. */
export interface VsmRowBound {
  bins: RowBins
  held?: { chunk: VsmChunk; key: Float64Array }
  scratch: Scratch
}
export const createVsmRowBound = (): VsmRowBound => ({
  bins: createRowBins(),
  scratch: createScratch(),
})

/** What the frame adds to the histogram (`BoundFrame`), rewritten by each bound. */
const frame: BoundFrame = { pairs: 0, cmds: 0, lamps: false, unplaced: 0, carried: false }

/**
 * The chunk of rows `[first, end)` of `spheres`, `candidates` of them drawn, under this frame's
 * `lights`: at least `worst.rows` rows. Undefined when the last histogram landed cannot bound them
 * (none yet, other rows, a sun turned, a directional light without its clipmap, no sun and no lamp
 * it binned): the caller keeps the worst case.
 */
export function vsmBoundChunk(
  bound: VsmRowBound,
  spheres: VsmRowSpheres,
  range: { first: number; end: number; candidates: number },
  lights: readonly VsmBoundLight[],
  worst: VsmWorst,
): VsmChunk | undefined {
  const lit = boundLights(lights)
  if (!lit || !(lit.suns.length || lit.maps.length)) return undefined
  const bins = bound.bins
  // More rows than the worst case's chunk: the lamps' bins may pay, and are made.
  bins.pays = range.candidates > worst.rows
  const landed = bins.landed
  if (!landed || landed.spheres !== spheres || landed.first !== range.first) return undefined
  if (!sameSuns(landed.suns, lit.suns, frameSuns(lit.suns), false)) return undefined
  const keys = lit.maps.length ? lampKeysOf(bins, lit.maps) : undefined
  const lamps = !!keys && !!landed.lampKeys && sameValues(keys, landed.lampKeys)
  if (!lit.suns.length && !lamps) return undefined
  const { motion } = spheres
  if (bins.read !== landed.seq) {
    bins.read = landed.seq
    bins.latency = Math.max(1, motion.commits - landed.commits)
  }
  // The rows beside the bins: the single-page maps', and the full maps' the bins do not hold.
  frame.pairs = frame.cmds = 0
  frame.lamps = lamps
  for (const light of lights) {
    if (!light.shouldRender || light.kind === 'directional') continue
    if (light.singlePage) frame.pairs += light.count
    else if (!lamps) frame.pairs += worst.pages
    else continue
    frame.cmds += light.count * VSM_MIPS
  }
  // Rows derived since, and rows past the range it binned: anywhere.
  frame.unplaced = motion.derived - landed.derived + Math.max(0, range.end - landed.end)
  frame.carried = motion.travel - landed.travel <= landed.margin
  if (!frame.carried) frame.unplaced += landed.movingRows
  const { chunk, hopeless } = answer(bound, worst, range.candidates, frame, landed)
  // Lamps whose rows alone fill the worst case's chunk: binned no more until they change.
  if (hopeless && bins.pays) bins.hopeless = keys
  return chunk
}
