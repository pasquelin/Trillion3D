// The depth pyramid a reflection march reads, built from any depth image for its tests: level 0
// of the nearest layer by the Hi-Z build's own first pass, the coarser texels of its three layers by
// the Hi-Z oracle's reductions.
import { shaderRun } from '../texture/shaderRun.fixture.ts'
import { HIZ_SHADER, HIZ_NEAREST_BUILD } from '../gpu/hiz/shader.ts'
import { pyramidBytes } from '../gpu/hiz/oracle.ts'
import { HIZ_MAX_LEVELS } from '../gpu/hiz/uniforms.ts'
import {
  HIZ_NEAREST,
  hizTextureSize,
  HIZ_WHOLE_FARTHEST,
  hizLevelWords,
} from '../gpu/hiz/pyramidTexture.ts'
import { hizReduceCeil, hizReduceNearestCeil } from '../../../sdk-core/src/hiz/oracles.fixture.ts'

const WORD = new Float32Array(1),
  BITS = new Uint32Array(WORD.buffer)
/** A depth as the pyramid holds it: its `f32` bits. */
const bitsOf = (value: number) => ((WORD[0] = value), BITS[0])

/**
 * The depth pyramid a march reads of the `width × height` depth image `depth`, at the packed
 * indices the Hi-Z lays (`pyramidBytes`), each texel made the first time a march reads it (and the
 * finer ones it covers before it): level 0 of the nearest layer by the shipped build's first pass
 * (`hizSource`, its plane's slopes and nearest corner), the coarser texels of every layer by the
 * oracle's reductions (`hizReduceCeil`, `hizReduceNearestCeil`). `word` is the texel the shipped
 * readers load (`hizTexel`'s place, a layer); `levels` the levels uniform.
 */
export function depthField(
  width: number,
  height: number,
  depth: ArrayLike<number>,
  front: ArrayLike<number> = [],
) {
  /** The nearest transparent surface's depth at a pixel, zero for none. */
  const frontOf = (i: number) => front[i] ?? 0
  /** The depth the pyramid reduces: the nearer of the opaque and the transparent one. */
  const merged = (i: number) => Math.max(depth[i], frontOf(i))
  const layout = pyramidBytes(width, height)
  const { sizes, offsets, texels, first, upper } = layout
  const made = Array.from({ length: HIZ_WHOLE_FARTHEST + 1 }, () =>
    new Float64Array(texels).fill(NaN),
  )
  const row = hizTextureSize(layout).width
  const slopes = new Uint32Array(width * height)
  const level0 = {},
    frontToken = {}
  const build = shaderRun<{
    hizSource: (at: number, x: number, y: number) => number[]
  }>(
    HIZ_SHADER,
    [
      'hizSource',
      'hizLoadBound',
      'hizPlaneNearest',
      'hizDepthAt',
      'hizFrontAt',
      'surfaceSlopeOf',
      'hizLayer',
      'hizLoad',
      'hizIn',
      'hizSlice',
      'hizTexel',
    ],
    {
      [HIZ_NEAREST_BUILD]: true,
      uni: { a: 0, b: width, c: height, upper },
      level0,
      front: frontToken,
      textureLoad: (t: object, p: number[]) => [
        Math.fround(t === frontToken ? frontOf(p[1] * width + p[0]) : depth[p[1] * width + p[0]]),
      ],
      hizPut: (i: number, _: number, word: number) => void (slopes[i] = word),
    },
  )
  /** The texel at `x, y` of `level` of `layer`, as a depth. */
  function cell(layer: number, level: number, x: number, y: number): number {
    const at = offsets[level] + y * sizes[level][0] + x
    if (Number.isNaN(made[layer][at])) {
      if (level === 0)
        made[layer][at] =
          layer === HIZ_NEAREST
            ? Math.fround(build.hizSource(0, x, y)[0])
            : Math.fround(merged(y * width + x))
      else {
        const [w, h] = sizes[level - 1],
          square: number[][] = []
        for (let v = 2 * y; v < Math.min(2 * y + 2, h); v++) {
          const row: number[] = []
          for (let u = 2 * x; u < Math.min(2 * x + 2, w); u++)
            row.push(cell(layer, level - 1, u, v))
          square.push(row)
        }
        made[layer][at] = Math.fround(
          (layer === HIZ_NEAREST ? hizReduceNearestCeil : hizReduceCeil)(square)[0][0],
        )
      }
    }
    return made[layer][at]
  }
  /** The bound a texel of a slice holds, and its natural packed index. */
  function bound(p: number[], slice: number) {
    const at = p[1] * row + p[0]
    const layer = slice === HIZ_WHOLE_FARTHEST ? Math.floor(at / upper) : slice
    return { layer, i: slice === HIZ_WHOLE_FARTHEST ? first + (at - layer * upper) : at }
  }
  const words = hizLevelWords(sizes, offsets, layout)
  return {
    width,
    height,
    levels: {
      level: Array.from({ length: HIZ_MAX_LEVELS }, (_, k) => [
        ...words.subarray(k * 4, k * 4 + 4),
      ]),
      count: [...words.subarray(HIZ_MAX_LEVELS * 4)],
    },
    /** Which bound the texel `p` of `slice` holds. */
    layerOf: (p: number[], slice: number) => bound(p, slice).layer,
    /** The word at texel `p` of the slice `slice` of the texture: a depth's bits, or a pixel's
     *  slopes. A level 0 lies in its own slice, the coarser levels of the three bounds in the
     *  last, one after the other (`hizRoute`). */
    word(p: number[], slice: number) {
      const { layer, i } = bound(p, slice)
      let level = 0
      while (level + 1 < sizes.length && offsets[level + 1] <= i) level++
      const [w] = sizes[level],
        x = (i - offsets[level]) % w,
        y = Math.floor((i - offsets[level]) / w)
      if (layer === HIZ_NEAREST && level === 0) return (cell(layer, 0, x, y), slopes[i])
      return bitsOf(cell(layer, level, x, y))
    },
    /** The depth level 0 holds at `p`: the opaque one. */
    depthAt: (p: number[]) => Math.fround(depth[p[1] * width + p[0]]),
    /** The nearest transparent surface's depth at `p`, zero for none. */
    frontAt: (p: number[]) => Math.fround(frontOf(p[1] * width + p[0])),
  }
}
export type DepthField = ReturnType<typeof depthField>
