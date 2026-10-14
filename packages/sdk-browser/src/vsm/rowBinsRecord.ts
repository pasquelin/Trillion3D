/**
 * THE HISTOGRAMS OF THE ROWS' SPHERES, AS THE CPU HOLDS THEM (`rowPageBound.ts`): what each one was
 * asked with (`RowBinsTag`, `rowBinsParams.ts`) — the frame's sums of the rows' motion
 * (`../gpu/shadow/rowMotion.ts`), the suns' references and axes, the lamps' keys, the margin its
 * moving rows were binned at —, and the last one landed, read back a few frames after the GPU made
 * it (`rowBinsGpu.ts`), never waited on.
 */
import type { VsmClipmap } from './clipmap.ts'
import { BIN_SPAN, PAIR_EDGES } from './rowBins.ts'
import type { VsmRowSpheres } from './rowPageBound.ts'

/** A sun as a histogram binned it: its clipmap, its light-space x and y, and the reference point,
 *  split as the spheres are (high f32, low f32). */
interface BinnedSun {
  clipmap: VsmClipmap
  axes: Float64Array
  ref: Float32Array
}

/** What a histogram was asked with. */
export interface RowBinsTag {
  seq: number
  spheres: VsmRowSpheres
  /** The rows `[first, end)` it binned. */
  first: number
  end: number
  /** The rows' motion sums when it was made. */
  derived: number
  travel: number
  commits: number
  /** The radius its moving rows were grown by. */
  margin: number
  suns: BinnedSun[]
  /** The full-map local lights' keys it binned jointly, none when it did not. */
  lampKeys: Float64Array | undefined
  /** Where its joint histogram starts, and its words in all. */
  jointAt: number
  words: number
}

/** A histogram landed: its words, and how many of its rows were moving. */
export interface RowBinsLanded extends RowBinsTag {
  counts: Uint32Array
  movingRows: number
}

/** A bound's histograms: the last one's number, the last encoded, the last landed, the commits one
 *  took to land, and whether the lamps' bins pay (more rows than the worst case's chunk); the lamps'
 *  signature, as last read, their keys, and the keys found unable to beat the worst case. */
export function createRowBins() {
  return {
    seq: 0,
    /** The last histogram encoded (`encodeRowBins`): an ask of the same inputs is not made again. */
    asked: undefined as RowBinsTag | undefined,
    landed: undefined as RowBinsLanded | undefined,
    /** The landed histogram last read: its latency is taken when another is. */
    read: 0,
    latency: 3,
    pays: true,
    sign: new Float64Array(0),
    maps: [] as unknown[],
    keys: undefined as Float64Array | undefined,
    hopeless: undefined as Float64Array | undefined,
  }
}
export type RowBins = ReturnType<typeof createRowBins>

/** The histogram `tag` asked, its words in `mapped`, landed — unless a later one already did —:
 *  the tag itself becomes the landed record. Its words are copied into the last landed one's array
 *  when of its size. */
export function landRowBins(bins: RowBins, tag: RowBinsTag, mapped: ArrayBuffer) {
  const held = bins.landed
  if (held && held.seq > tag.seq) return
  const counts = held && held.counts.length === tag.words ? held.counts : new Uint32Array(tag.words)
  counts.set(new Uint32Array(mapped, 0, tag.words))
  // The moving rows: a sun's moving bins, else the joint pairs' moving edges.
  const [from, to] = tag.suns.length
    ? [BIN_SPAN, 2 * BIN_SPAN]
    : [tag.jointAt + PAIR_EDGES.length, tag.jointAt + 2 * PAIR_EDGES.length]
  let movingRows = 0
  if (tag.suns.length || tag.lampKeys) for (let i = from; i < to; i++) movingRows += counts[i]
  const landed = tag as RowBinsLanded
  landed.counts = counts
  landed.movingRows = movingRows
  bins.landed = landed
}
