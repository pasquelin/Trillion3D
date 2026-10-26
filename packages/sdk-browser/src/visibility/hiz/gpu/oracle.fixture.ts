import {
  hizBuildPyramid,
  hizReduceCeil,
  hizReduceNearestCeil,
} from '../../../../../sdk-core/src/hiz/oracles.fixture.ts'
import { pyramidBytes } from './oracle.ts'

/** One ceil-2×2 reduction of a packed level: the farthest of each square (the minimum, the
 *  engine's depth being reversed), or, `nearest`, the nearest (the maximum); `gather` the first
 *  level's, read from the depth itself (`hizReduceCeil`). */
export function evaluateHizReduce(
  src: Float32Array,
  srcWidth: number,
  srcHeight: number,
  nearest = false,
  gather = false,
) {
  const reduce = nearest ? hizReduceNearestCeil : hizReduceCeil
  const reduced = reduce(rowsOf(src, srcWidth, srcHeight), gather)
  const height = reduced.length,
    width = height ? reduced[0].length : 0
  const data = new Float32Array(Math.max(1, width * height))
  for (let y = 0; y < height; y++) data.set(reduced[y], y * width)
  return { data, width, height }
}

/** Pack level-0 rows into the full ceil-max pyramid used by the GPU kernel. */
export function packHizPyramid(level0: readonly (readonly number[])[]): PackedHiz {
  const levels = hizBuildPyramid(level0)
  const { sizes, offsets, texels, first, upper } = pyramidBytes(level0[0].length, level0.length)
  const data = new Float32Array(texels)
  for (let i = 0; i < levels.length; i++) {
    const level = levels[i],
      [w] = sizes[i],
      base = offsets[i]
    for (let y = 0; y < level.length; y++) data.set(level[y], base + y * w)
  }
  return { data, sizes, offsets, first, upper }
}

/** The finished depth's farthest layer for the depth `level0`, packed as the nearest build writes
 *  it: the farthest pyramid of the depth from level 1 up, level 0 — the depth texture itself —
 *  left at zero. */
export function packWholeFarthest(level0: readonly (readonly number[])[]) {
  const packed = packHizPyramid(level0)
  packed.data.fill(0, 0, packed.offsets[1] ?? packed.data.length)
  return packed
}

/** The packed pyramid of the bound `layer` read back from the texture's two slices `slices`: level 0
 *  of every bound zero (the slopes are not a bound), the coarser levels from the last slice. */
export function hizPackedFrom(
  slices: readonly Uint32Array[],
  layer: number,
  { first, upper }: { first: number; upper: number },
) {
  const words = new Uint32Array(first + upper)
  words.set(slices[slices.length - 1].subarray(layer * upper, layer * upper + upper), first)
  return words
}

export type PackedHiz = {
  data: Float32Array<ArrayBuffer>
  sizes: Array<[number, number]>
  offsets: number[]
  /** The texels at level 0 and in the coarser levels (`pyramidBytes`). */
  first: number
  upper: number
}

function rowsOf(data: Float32Array, width: number, height: number) {
  const rows: number[][] = []
  for (let y = 0; y < height; y++) {
    const row = new Array<number>(width)
    for (let x = 0; x < width; x++) row[x] = data[y * width + x]
    rows.push(row)
  }
  return rows
}
