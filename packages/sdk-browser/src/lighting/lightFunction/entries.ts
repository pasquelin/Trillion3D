import { toHalf } from '../../../../math/src/float/half.ts'
import { crossVector3, dotVector3, normalizeVector3 } from '../../../../math/src/vector/vector.ts'
import { LIGHT_KIND, type SceneLight } from '../../../../sdk-core/src/scene/light/contracts.ts'
import {
  lightFunctionConeTangentOf,
  lightFunctionDisabledOf,
  lightFunctionFadeOf,
  lightFunctionScaleOf,
} from '../../../../sdk-core/src/scene/light/lightFunction.ts'
import { ATLAS_NUMBERS_AT, ENTRY_VEC4S } from './layout.ts'

/** Floats of an entry of the table. */
const ENTRY_FLOATS = ENTRY_VEC4S * 4

/** The axes of a light, unit: the one it shines along, its right and its up. A rectangle's are its
 *  face's normal, its width axis and the third; any other light shines along its direction (down,
 *  where it names none), turned about it as a camera looking along it would be, the scene's up up.
 *  The projection's coordinates are `(up, right, along)` over the scale `(x, y, z)` the light names. */
const forward = [0, 0, 0],
  right = [0, 0, 0],
  up = [0, 0, 0]
function axesOf(light: SceneLight) {
  forward.splice(0, 3, ...(light.direction ?? [0, -1, 0]))
  if (light.right) {
    right.splice(0, 3, ...light.right)
  } else {
    // The scene's up, unless the light shines along it: then the scene's back.
    const tilted = Math.abs(forward[1]) > 0.9999
    crossVector3(right, forward, tilted ? [0, 0, -1] : [0, 1, 0])
    normalizeVector3(right)
  }
  crossVector3(up, right, forward)
  normalizeVector3(up)
}

/** The tangent of the cone `light`'s function is projected through, negative for none: a spot's own
 *  cone; a rectangle's light function cone when it has one. */
function coneTangentOf(light: SceneLight) {
  if (light.kind === 'spot') return Math.tan(light.outerConeAngle!)
  return light.kind === 'rect' ? lightFunctionConeTangentOf(light) || -1 : -1
}

/** Writes the four rows of the matrix that takes a world point to `(along / scale.z, right / scale.y,
 *  up / scale.x)` of `light`, as a row vector times the matrix, at `out[at..]`. */
function writeMatrix(out: Float32Array, at: number, light: SceneLight) {
  axesOf(light)
  const [sx, sy, sz] = lightFunctionScaleOf(light)
  const place = light.position ?? [0, 0, 0]
  const scales = [sz, sy, sx]
  const axes = [forward, right, up]
  for (let row = 0; row < 3; row++)
    for (let column = 0; column < 3; column++)
      out[at + row * 4 + column] = axes[column][row] / scales[column]
  for (let column = 0; column < 3; column++)
    out[at + 12 + column] = -dotVector3(axes[column], place) / scales[column]
  out[at + 15] = 1
}

/** Where a slot starts in the atlas, as the head packs it: u then v, 16 bits each, of the texel's
 *  centre over the atlas's side. */
const cornerWord = (x: number, y: number, slot: number, side: number) =>
  Math.round(((x * slot + 0.5) / side) * 65536) |
  (Math.round(((y * slot + 0.5) / side) * 65536) << 16)

/**
 * Writes entry `index` of the table `out` (`layout.ts`) for `light`, whose function sits in the slot
 * at `(x, y)` of an atlas of `side` texels in slots of `slot`.
 */
export function writeEntry(
  out: Float32Array,
  index: number,
  light: SceneLight,
  at: { x: number; y: number; slot: number; side: number },
) {
  const base = index * ENTRY_FLOATS
  out.fill(0, base, base + ENTRY_FLOATS)
  const words = new Uint32Array(out.buffer, out.byteOffset + base * 4, 4)
  out[base] = lightFunctionFadeOf(light)
  words[1] = LIGHT_KIND[light.kind] | (toHalf(lightFunctionDisabledOf(light)) << 8)
  words[2] = cornerWord(at.x, at.y, at.slot, at.side)
  out[base + 3] = coneTangentOf(light)
  writeMatrix(out, base + 4, light)
}

/** The bytes of a light's block for the pass that evaluates its function apart from the atlas (`writeStandaloneLight`). */
export const STANDALONE_LIGHT_BYTES = 96

/**
 * Writes the block of `light`, whose rank in the light buffer is `rank`, for the pass that evaluates its function apart from the
 * atlas (`standaloneMaskWgsl.ts`), at `base` bytes of `out`: the four rows of the matrix that takes a world point to the
 * light's axes (as the table's entries hold it), then the tangent of a spot's outer cone (1 for any other light, which uses none),
 * the fade distance and the disabled brightness, then the rank and the light's kind rank (`LIGHT_KIND`), as 16 bytes of words.
 */
export function writeStandaloneLight(
  out: ArrayBuffer,
  base: number,
  light: SceneLight,
  rank: number,
) {
  const floats = new Float32Array(out, base, STANDALONE_LIGHT_BYTES / 4)
  const words = new Uint32Array(out, base, STANDALONE_LIGHT_BYTES / 4)
  writeMatrix(floats, 0, light)
  floats[16] = light.kind === 'spot' ? Math.tan(light.outerConeAngle!) : 1
  floats[17] = lightFunctionFadeOf(light)
  floats[18] = lightFunctionDisabledOf(light)
  floats[19] = 0
  words[20] = rank
  words[21] = LIGHT_KIND[light.kind]
  words[22] = 0
  words[23] = 0
}

/** Writes entry 0, which no light reads as its own: white's head, and the atlas's numbers every
 *  entry shares (`ATLAS_NUMBERS_AT`): the slot's size in atlas coordinates, the sides, and whether
 *  the fog's local lights read the light functions. */
export function writeDefaultEntry(
  out: Float32Array,
  slot: number,
  side: number,
  fogLocals: boolean,
) {
  out.set([1, 1, 1, 0], 0)
  out.set([(slot - 1) / side, side, slot, fogLocals ? 1 : 0], ATLAS_NUMBERS_AT * 4)
}
