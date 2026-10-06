// What the temporal resolve calls beyond `shaderRunBuiltins.fixture.ts`, for the runs of its
// shipped text in JavaScript: the half-float packing its flicker history is stored with (the
// engine's own half conversion, `ltcTable.ts`), and the engine's integer hash
// (`../math/hashUnitWgsl.ts`) in 32-bit integer arithmetic, which a double would not wrap.
import { fromHalf, toHalf } from '../../../sdk-core/src/lighting/ltcTable.ts'
import { FLICKER_COUNT_RATE, flickerParallax } from './shadingHistoryWgsl.ts'

/** `pack2x16float`: two half floats, the first in the low 16 bits. */
const pack2x16float = (v: number[]) => (toHalf(v[0]) | (toHalf(v[1]) << 16)) >>> 0

/** `unpack2x16float`: the two half floats of a word, the low 16 bits first. */
const unpack2x16float = (word: number) => [fromHalf(word & 0xffff), fromHalf(word >>> 16)]

/** `hashUnit`, as `HASH_UNIT_WGSL` computes it in `u32`. */
function hashUnit(seed: number) {
  let x = (Math.imul(seed >>> 0, 747796405) + 2891336453) >>> 0
  x = Math.imul(((x >>> ((x >>> 28) + 4)) ^ x) >>> 0, 277803737) >>> 0
  x = ((x >>> 22) ^ x) >>> 0
  return Math.fround(Math.fround(x) * Math.fround(2.3283064e-10))
}

/** The flicker measure's structure (`SHADING_HISTORY_WGSL`), built by member name. */
const ShadingMoire = (
  luma: number,
  gradient: number,
  variation: number,
  count: number,
  error: number,
) => ({
  luma,
  gradient,
  variation,
  count,
  error,
})

/** The page record's two terms a pixel carries (`PAGE_OF_WGSL`), built by member name. */
const TaaPage = (identity: number, animated: number) => ({ identity, animated })

/** The nearest surface of a pixel's 3×3 (`NEAREST_OF_WGSL`), built by member name. */
const TaaNearest = (depth: number, slope: number, id: number) => ({ depth, slope, id })

export const taaBuiltins = {
  pack2x16float,
  unpack2x16float,
  hashUnit,
  ShadingMoire,
  TaaPage,
  TaaNearest,
}

/** A texture the fixtures read by texel: a vector, or a depth texture's value. */
type Texels = (at: number[]) => number | number[]

/**
 * `textureGather` through a sampler clamped to the edge, its texture of `dimensions`: the 2×2 that
 * bilinear filtering would weigh at `uv`, in WGSL's lane order — x (i0, j1), y (i1, j1), z (i1, j0),
 * w (i0, j0) —, component `component` of each, a depth texture's value without one.
 */
export const textureGatherOf =
  (dimensions: (texture: Texels) => number[]) =>
  (...args: unknown[]) => {
    const [component, texture, , uv] = (args.length === 3 ? [0, ...args] : args) as [
      number,
      Texels,
      unknown,
      number[],
    ]
    const [width, height] = dimensions(texture),
      x = Math.floor(uv[0] * width - 0.5),
      y = Math.floor(uv[1] * height - 0.5),
      edge = (v: number, size: number) => Math.min(Math.max(v, 0), size - 1)
    const at = (dx: number, dy: number) => {
      const value = texture([edge(x + dx, width), edge(y + dy, height)])
      return typeof value === 'number' ? value : value[component]
    }
    return [at(0, 1), at(1, 1), at(1, 0), at(0, 0)]
  }

/** The resolve's own functions in `shader`, what the fixtures run of it: the colour space's two and
 *  every one declared after the deformation's, the hash left to the scope's integer one. */
export function resolveFunctions(shader: string) {
  const declared = [...shader.matchAll(/\bfn (\w+)\(/g)].map((match) => match[1])
  const own = declared.slice(declared.indexOf('deformedPrevious') + 1)
  return ['toYcocg', 'fromYcocg', ...own.filter((name) => name !== 'hashUnit')]
}

/** The uniform's fields past the header the fixtures fill: no camera move since the last image,
 *  flicker rates of a 60 Hz frame on a display `width` wide, render pixels of unit world width, the
 *  flicker measure on. */
export const stillViewFields = (width: number, countRate = FLICKER_COUNT_RATE) => ({
  parallax: [0, 0, 0, 0],
  moire: [countRate, flickerParallax(width), 1, 1],
})

/** A flicker history as `shadingPack` stores it, its one word: blurred luma, total, count
 *  (normalised). */
export function moireStored(luma: number, variation = 0, count = 0) {
  const counts = (Math.round(variation * 255) << 8) | Math.round(count * 255)
  return [((pack2x16float([luma, 0]) & 0xffff) | (counts << 16)) >>> 0, 0, 0, 0]
}
