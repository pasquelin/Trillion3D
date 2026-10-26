// The depth pyramid a reflection march reads, built from any depth image for its tests: level 0
// of the nearest layer by the Hi-Z build's own first pass, the coarser texels of its three layers by
// the Hi-Z oracle's reductions.
import { f32Bits } from '../../../../math/src/float/bits.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { HIZ_SHADER, HIZ_WITH_TRACE } from '../../visibility/hiz/gpu/shader.ts'
import { pyramidBytes } from '../../visibility/hiz/gpu/oracle.ts'
import { HIZ_BUILD_SIDE, HIZ_MAX_LEVELS } from '../../visibility/hiz/gpu/uniforms.ts'
import {
  HIZ_DEPTH_LAYERS,
  HIZ_FRONT_LAYER,
  HIZ_NEAREST,
  hizTextureSize,
  HIZ_WHOLE_FARTHEST,
} from '../../visibility/hiz/gpu/pyramidTexture.ts'
import {
  HIZ_LEVELS_FRONT_WORD,
  HIZ_LEVELS_PLANES_WORD,
  hizLevelWords,
} from '../../visibility/hiz/gpu/levelsUniform.ts'
import {
  hizSquareStart,
  hizReduceCeil,
  hizReduceNearestCeil,
} from '../../../../sdk-core/src/hiz/oracles.fixture.ts'

/** The depth readers of `hizDepthWgsl` a march runs (`shaderRun`), the shipped functions by name. */
export const HIZ_DEPTH_READERS = [
  'hizPlane',
  'hizOpaqueDepth',
  'hizPixel',
  'hizPixelIn',
  'hizFold',
  'hizFoldOver',
  'hizFrontDepth',
  'hizFrontOver',
  'hizCellStep',
  'hizCellNearest',
  'hizCellFarthest',
  'hizCellCullFarthest',
  'hizLevelCount',
  'hizTracePlanes',
  'hizCullFarthest',
  'hizNearest',
  'hizWholeFarthest',
  'hizSlice',
  'hizTexel',
]

/** The depth image `width × height` whose pixel `(x, y)` holds `depth(x, y)`. */
export const depthImage = (
  width: number,
  height: number,
  depth: (x: number, y: number) => number,
) =>
  Float64Array.from({ length: width * height }, (_, i) => depth(i % width, Math.floor(i / width)))

/**
 * The `textureLoad` of the readers over `field`: of `token.depth`, level 0, the opaque depth in its
 * first layer and the nearest transparent surface's in its second (`HIZ_FRONT_LAYER`); a word of
 * the pyramid for any other texture; `onNearest` is told each cell of the nearest layer a march
 * reads.
 */
export const depthLoads =
  (field: DepthField, token: { depth: object }, onNearest: (cell: number[]) => void) =>
  (t: object, cell: number[], layer: number) => {
    if (t === token.depth)
      return [layer === HIZ_FRONT_LAYER ? field.frontAt(cell) : field.depthAt(cell)]
    if (field.layerOf(cell, layer) === HIZ_NEAREST) onNearest(cell)
    return [field.word(cell, layer)]
  }

/**
 * The depth pyramid a march reads of the `width × height` depth image `depth`, at the packed
 * indices the Hi-Z lays (`pyramidBytes`), each texel made the first time a march reads it (and the
 * finer ones it covers before it): level 0 of the nearest layer by the shipped build's first pass
 * (`hizSource`, its plane's slopes and nearest corner), the coarser texels of every layer by the
 * oracle's reductions (`hizReduceCeil`, `hizReduceNearestCeil`). `word` is the texel the shipped
 * readers load (`hizTexel`'s place, a layer); `levels` the levels uniform. `planes` is the build's
 * mode (`hizTrace` `'planes'`, which the march tests of the planes pin; false, the closest depth of
 * each centre the reference's walk reads).
 */
export function depthField(
  width: number,
  height: number,
  depth: ArrayLike<number>,
  front: ArrayLike<number> = [],
  planes = true,
) {
  /** The nearest transparent surface's depth at a pixel, zero for none. */
  const frontOf = (i: number) => front[i] ?? 0
  const layout = pyramidBytes(width, height)
  const { sizes, offsets, texels, first, upper } = layout
  const made = Array.from({ length: HIZ_WHOLE_FARTHEST + 1 }, () =>
    new Float64Array(texels).fill(NaN),
  )
  const row = hizTextureSize(layout).width
  const slopes = new Uint32Array(width * height)
  // Level 0 with its front layer: the opaque depth, then the nearest transparent surface's.
  const level0 = { layers: HIZ_DEPTH_LAYERS }
  const build = shaderRun<{
    hizSource: (at: number, x: number, y: number) => number[]
    hizLoadDepthTile: (wg: number[], thread: number) => void
  }>(
    HIZ_SHADER,
    [
      'hizSource',
      'hizLoadDepthTile',
      'hizLoadBound',
      'hizPlaneCorners',
      'hizDepthAt',
      'hizFrontAt',
      'hizFold',
      'surfaceSlopeOf',
      'hizLevel0',
      'hizLoad',
      'hizIn',
      'hizSlice',
      'hizTexel',
    ],
    {
      [HIZ_WITH_TRACE]: true,
      // This image wrote the front layer: zero where no transparent surface lies.
      uni: { a: 0, b: width, c: height, upper, front: 1, planes: planes ? 1 : 0 },
      level0,
      // Level 0's two layers: the opaque depth, then the nearest transparent surface's.
      textureLoad: (_: object, p: number[], layer: number) => [
        Math.fround(
          layer === HIZ_FRONT_LAYER ? frontOf(p[1] * width + p[0]) : depth[p[1] * width + p[0]],
        ),
      ],
      hizPut: (i: number, _: number, word: number) => void (slopes[i] = word),
      // The workgroup's depth tile and its first pixel, which `hizLoadDepthTile` writes.
      hizDepthTile: new Float64Array((2 * HIZ_BUILD_SIDE + 4) ** 2),
      hizDepthOrigin: [0, 0],
    },
  )
  /** The workgroup whose depth tile the build holds. */
  let tiled = ''
  /** The shipped first pass at the pixel `(x, y)`: its workgroup's depth tile loaded first, by
   *  every thread of it, as the build does before its barrier. */
  function source(x: number, y: number) {
    const wg = [Math.floor(x / (2 * HIZ_BUILD_SIDE)), Math.floor(y / (2 * HIZ_BUILD_SIDE))]
    if (`${wg}` !== tiled) {
      for (let thread = 0; thread < HIZ_BUILD_SIDE ** 2; thread++)
        build.hizLoadDepthTile(wg, thread)
      tiled = `${wg}`
    }
    return build.hizSource(0, x, y)
  }
  /** The texel at `x, y` of `level` of `layer`, as a depth. */
  function cell(layer: number, level: number, x: number, y: number): number {
    const at = offsets[level] + y * sizes[level][0] + x
    if (Number.isNaN(made[layer][at])) {
      if (level === 0) made[layer][at] = Math.fround(source(x, y)[layer === HIZ_NEAREST ? 1 : 2])
      else {
        const [w, h] = sizes[level - 1],
          square: number[][] = []
        const v0 = hizSquareStart(y, h, level === 1),
          u0 = hizSquareStart(x, w, level === 1)
        for (let v = v0; v < Math.min(v0 + 2, h); v++) {
          const row: number[] = []
          for (let u = u0; u < Math.min(u0 + 2, w); u++) row.push(cell(layer, level - 1, u, v))
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
    if (slice === 0) return { layer: HIZ_NEAREST, i: at }
    const layer = Math.floor(at / upper)
    return { layer, i: first + (at - layer * upper) }
  }
  const words = hizLevelWords(sizes, offsets, layout)
  words[HIZ_LEVELS_FRONT_WORD] = 1
  words[HIZ_LEVELS_PLANES_WORD] = planes ? 1 : 0
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
     *  slopes. A level 0 lies in the first slice, the coarser levels of the three bounds in the
     *  second, one after the other (`hizRoute`). */
    word(p: number[], slice: number) {
      const { layer, i } = bound(p, slice)
      let level = 0
      while (level + 1 < sizes.length && offsets[level + 1] <= i) level++
      const [w] = sizes[level],
        x = (i - offsets[level]) % w,
        y = Math.floor((i - offsets[level]) / w)
      if (layer === HIZ_NEAREST && level === 0) return (cell(layer, 0, x, y), slopes[i])
      return f32Bits(cell(layer, level, x, y))
    },
    /** The depth level 0 holds at `p`: the opaque one. */
    depthAt: (p: number[]) => Math.fround(depth[p[1] * width + p[0]]),
    /** The nearest transparent surface's depth at `p`, zero for none. */
    frontAt: (p: number[]) => Math.fround(frontOf(p[1] * width + p[0])),
  }
}
export type DepthField = ReturnType<typeof depthField>
