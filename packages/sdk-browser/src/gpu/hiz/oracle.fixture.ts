import {
  hizBuildPyramid,
  hizReduceCeil,
  hizReduceNearestCeil,
} from '../../../../sdk-core/src/hiz/oracles.fixture.ts'
import { pyramidBytes } from './oracle.ts'
import { HIZ_WHOLE_FARTHEST, hizTextureSize } from './pyramidTexture.ts'
import { VERDICT_REJECTED, VERDICT_KEPT } from '../partition/contract.ts'
import type { FlatHizPyramid } from '../../hiz/types.ts'
import { hizRejects, type HizBounds } from '../../../../../bench/oracles/browser/hizRejects.ts'

/** One ceil-2×2 reduction of a packed level: the farthest of each square (the minimum, the
 *  engine's depth being reversed), or, `nearest`, the nearest (the maximum). */
export function evaluateHizReduce(
  src: Float32Array,
  srcWidth: number,
  srcHeight: number,
  nearest = false,
) {
  const reduce = nearest ? hizReduceNearestCeil : hizReduceCeil
  const reduced = reduce(rowsOf(src, srcWidth, srcHeight))
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

/** The words of the pyramid texture's layers (`pyramidTexture.ts`) that hold the bound `packed`
 *  (`layer`'s, its texels as depths): the layer's own level 0, when it has one, and the share of the
 *  last layer its coarser levels take (`hizRoute`). Each is a full layer, row after row of
 *  `hizTextureSize`, zero elsewhere. */
export function hizLayerWords(packed: PackedHiz, layer: number) {
  const split = packed
  const size = hizTextureSize(split)
  const bits = new Uint32Array(packed.data.buffer, packed.data.byteOffset, packed.data.length)
  const layers = new Map<number, Uint32Array<ArrayBuffer>>()
  if (layer !== HIZ_WHOLE_FARTHEST)
    layers.set(
      layer,
      Uint32Array.from({ length: size.width * size.height }, (_, i) => bits[i] ?? 0).fill(
        0,
        split.first,
      ),
    )
  const last = new Uint32Array(size.width * size.height)
  last.set(bits.subarray(split.first), layer * split.upper)
  layers.set(HIZ_WHOLE_FARTHEST, last)
  return { ...size, layers }
}

/** The packed pyramid of the bound `layer` (`hizLayerWords`) read back from the texture's layers
 *  `layers`, level 0 of the whole bound zero. */
export function hizPackedFrom(
  layers: readonly Uint32Array[],
  layer: number,
  { first, upper }: { first: number; upper: number },
) {
  const words = new Uint32Array(first + upper)
  if (layer !== HIZ_WHOLE_FARTHEST) words.set(layers[layer].subarray(0, first))
  words.set(layers[HIZ_WHOLE_FARTHEST].subarray(layer * upper, layer * upper + upper), first)
  return words
}

/** Same rejection as `hizRejects` (mip-selected inclusive footprint, near clips never hide). */
export function evaluateHizTest(packed: PackedHiz, bounds: HizBounds[], bias = 0) {
  const pyramid = pyramidFromPacked(packed)
  const flags = new Uint32Array(bounds.length)
  for (let i = 0; i < bounds.length; i++)
    flags[i] = hizRejects(pyramid, bounds[i], bias) ? VERDICT_REJECTED : VERDICT_KEPT
  return flags
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

/** The GPU kernel's pack is already flat: the CPU test's pyramid reads it without copying it. */
function pyramidFromPacked(packed: PackedHiz): FlatHizPyramid {
  return {
    data: packed.data,
    offsets: Int32Array.from(packed.offsets),
    widths: Int32Array.from(packed.sizes, ([w]) => w),
    heights: Int32Array.from(packed.sizes, ([, h]) => h),
    count: packed.sizes.length,
  }
}
