/**
 * THE FOG'S CUBEMAP: the colour the fog scatters toward the eye, by direction, read from a picture
 * of the sky around the scene instead of one colour.
 *
 * Far and heavily fogged elements then take the colours of the sky they stand against. A ray
 * reads the cubemap by its direction (rotated about the vertical by `turn`), twice: its sharpest
 * level, and its smallest — one texel a face, each the face's mean colour, which the sampler blends
 * across the faces' edges: the sky's average colour around the ray —, and blends the two by its
 * length: from the average at `averageUntil` and nearer to the sharp reading at
 * `sharpFrom` and farther. The result is multiplied by `tint`. With a cubemap, the fog's
 * own `color` is not read (the tint takes its place) and the sun's lobe is off: the cubemap says
 * the colours.
 *
 * The picture is data: `size` texels across a face and `texels`, the six faces in the order `+x, −x,
 * +y, −y, +z, −z` of a cube texture looked up by the scene's own direction (+y up), each row by row
 * from its top-left corner, three linear numbers per texel. The smallest level is made of the faces'
 * means (`faceAverages`). The data is not copied: it must not be written after it is set.
 */
import { colourOf, finite, objectOf, rangedFields, refuse, type FogRange } from './fogChecks.ts'
import type { LinearRgb } from '../../contracts/material.ts'

/** The fog's cubemap (`SceneHeightFog.cubemap`). */
export interface SceneFogCubemap {
  /** Texels across one face, from 1 to 1024. */
  size: number
  /** The six faces, `6 · size² · 3` linear numbers ≥ 0. */
  texels: ArrayLike<number>
  /** The colour the lookup is multiplied by, linear RGB; white by default. */
  tint?: LinearRgb
  /** The rotation of the cubemap about the vertical, degrees, in [0, 360]; 0 by default. */
  turn?: number
  /** From this distance on, metres, the cubemap is read at its sharpest; 1000 by default. */
  sharpFrom?: number
  /** Up to this distance, metres, only the average colour of the face is read; 10 by default. */
  averageUntil?: number
}

/** A cubemap with every field set. */
export interface ResolvedFogCubemap {
  size: number
  texels: ArrayLike<number>
  tint: LinearRgb
  turn: number
  sharpFrom: number
  averageUntil: number
}

/** The defaults of the cubemap's settings, the converted ones of the engines that fixed them:
 *  100 000 and 1 000 centimetres are 1000 and 10 metres. */
export const CUBEMAP_DEFAULTS = {
  tint: [1, 1, 1],
  turn: 0,
  sharpFrom: 1000,
  averageUntil: 10,
} as const satisfies Omit<ResolvedFogCubemap, 'size' | 'texels'>

/** The most texels across a face: six faces of that size in half floats, with their levels, are
 *  about 60 MB, which every device holds. */
export const CUBEMAP_MAX_SIZE = 1024

/** The levels of a cubemap of `size` texels a face: down to one texel. */
export const cubemapMipCount = (size: number) => Math.floor(Math.log2(size)) + 1

/** The cubemap a declaration is, every field set: the defaults for what it leaves out. */
export function resolveFogCubemap(cube: SceneFogCubemap): ResolvedFogCubemap {
  const d = CUBEMAP_DEFAULTS
  return {
    size: cube.size,
    texels: cube.texels,
    tint: cube.tint ?? d.tint,
    turn: cube.turn ?? d.turn,
    sharpFrom: cube.sharpFrom ?? d.sharpFrom,
    averageUntil: cube.averageUntil ?? d.averageUntil,
  }
}

/** The range of each number of the cubemap besides its picture. */
const CUBEMAP_RANGES = {
  turn: [0, 360],
  sharpFrom: [0, Infinity],
  averageUntil: [0, Infinity],
} as const satisfies Record<string, FogRange>

/** A cubemap checked: a whole number of texels a face, the faces' numbers finite and ≥ 0, the
 *  colours of three, the distances and the turn within their ranges. The texels are kept, not
 *  copied. */
export function validateFogCubemap(cube: unknown, fog: unknown): SceneFogCubemap {
  const c = objectOf<SceneFogCubemap>(cube, 'cubemap', fog)
  if (!Number.isInteger(c.size) || c.size < 1 || c.size > CUBEMAP_MAX_SIZE)
    refuse(`cubemap.size must be a whole number from 1 to ${CUBEMAP_MAX_SIZE}`, fog)
  const need = 6 * c.size * c.size * 3
  const { texels } = c
  if (!texels || texels.length !== need)
    refuse(`cubemap.texels expects ${need} numbers, six faces of ${c.size}² texels`, fog)
  for (let i = 0; i < need; i++)
    if (!finite(texels[i]) || texels[i] < 0)
      refuse('cubemap.texels expects finite numbers ≥ 0', fog)
  const out: SceneFogCubemap = { size: c.size, texels }
  if (c.tint !== undefined) out.tint = colourOf(c.tint, 'cubemap.tint', fog)
  rangedFields(c, out, CUBEMAP_RANGES, fog, 'cubemap.')
  return out
}

/** The smallest level of the cubemap, the one the fog blends toward with the ray's length: one texel
 *  a face, the mean of the face's texels — what the chain of two-by-two box means down to one texel
 *  holds, for a face whose side is a power of two. Six colours of three numbers, in the faces' order. */
export function faceAverages(cube: Pick<ResolvedFogCubemap, 'size' | 'texels'>): Float32Array {
  const texels = cube.size * cube.size
  const sums = new Float64Array(6 * 3)
  for (let i = 0; i < 6 * texels; i++)
    for (let c = 0; c < 3; c++) sums[Math.floor(i / texels) * 3 + c] += cube.texels[i * 3 + c]
  return Float32Array.from(sums, (sum) => sum / texels)
}
