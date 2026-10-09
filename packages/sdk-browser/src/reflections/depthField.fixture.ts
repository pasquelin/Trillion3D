// The depth pyramid a reflection march reads, built from any depth image for its tests: level 0
// of the nearest layer by the Hi-Z build's own first pass, the coarser texels of its three layers by
// the Hi-Z oracle's reductions.
import { shaderRun } from '../texture/shaderRun.fixture.ts'
import { HIZ_SHADER, HIZ_NEAREST_BUILD } from '../gpu/hiz/shader.ts'
import { pyramidBytes } from '../gpu/hiz/oracle.ts'
import {
  HIZ_NEAREST,
  HIZ_ROW,
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
export function depthField(width: number, height: number, depth: ArrayLike<number>) {
  const { sizes, offsets, texels } = pyramidBytes(width, height)
  const made = Array.from({ length: HIZ_WHOLE_FARTHEST + 1 }, () =>
    new Float64Array(texels).fill(NaN),
  )
  const slopes = new Uint32Array(width * height)
  const level0 = {}
  const build = shaderRun<{
    hizSource: (at: number, origin: number[], x: number, y: number) => number[]
  }>(
    HIZ_SHADER,
    [
      'hizSource',
      'hizLoadBound',
      'hizPlaneNearest',
      'hizDepthAt',
      'surfaceSlopeOf',
      'hizLayer',
      'hizLoad',
      'hizTexel',
    ],
    {
      [HIZ_NEAREST_BUILD]: true,
      uni: { a: 0, b: width, c: height },
      level0,
      textureLoad: (_: object, p: number[]) => [Math.fround(depth[p[1] * width + p[0]])],
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
            ? Math.fround(build.hizSource(0, [0, 0], x, y)[0])
            : Math.fround(depth[y * width + x])
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
  const words = hizLevelWords(sizes, offsets)
  return {
    width,
    height,
    levels: {
      level: Array.from({ length: words.length / 4 }, (_, k) => [
        ...words.subarray(k * 4, k * 4 + 4),
      ]),
    },
    /** The word at texel `p` of `layer`: a depth's bits, or a pixel's slopes. */
    word(p: number[], layer: number) {
      const i = p[1] * HIZ_ROW + p[0]
      let level = 0
      while (level + 1 < sizes.length && offsets[level + 1] <= i) level++
      const [w] = sizes[level],
        x = (i - offsets[level]) % w,
        y = Math.floor((i - offsets[level]) / w)
      if (layer === HIZ_NEAREST && level === 0) return (cell(layer, 0, x, y), slopes[i])
      return bitsOf(cell(layer, level, x, y))
    },
    /** The depth level 0 holds at `p`. */
    depthAt: (p: number[]) => Math.fround(depth[p[1] * width + p[0]]),
  }
}
export type DepthField = ReturnType<typeof depthField>
