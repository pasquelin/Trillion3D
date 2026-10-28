// The material of a strand's sample as the CPU packs and reads it: the twin of the material pass's packing, for the proofs.
import { saturate } from '../../../math/src/scalar/reals.ts'
import { HAIR_MACRO_GROUP_MASK, HAIR_MACRO_GROUP_SHIFT } from './materialMath.ts'
import { HAIR_NODE_DATA_WORDS } from './visibilityMath.ts'

/** The bits of a sample's control point. */
const HAIR_CONTROL_POINT_MASK = 0x0fffffff

/** A compacted sample's material, as the passes after the material pass read it. */
export interface HairSample {
  depth: number
  tangent: readonly [number, number, number]
  coverage8: number
  controlPoint: number
  macroGroup: number
  baseColor: readonly [number, number, number]
  roughness: number
  specular: number
  backlit: number
  flags: number
  lightChannels: number
}

/** `floor(saturate(x) * 255)`, as the shader's float does it (`unitByte`). */
export const hairUnitByte = (x: number) => Math.floor(Math.fround(saturate(x) * 255))

/** The five words of `sample`. */
export function packHairSample(sample: HairSample, out = new Uint32Array(HAIR_NODE_DATA_WORDS)) {
  const view = new DataView(out.buffer, out.byteOffset, HAIR_NODE_DATA_WORDS * 4)
  view.setFloat32(0, sample.depth, true)
  out[1] =
    ((sample.controlPoint & HAIR_CONTROL_POINT_MASK) |
      ((sample.macroGroup & HAIR_MACRO_GROUP_MASK) << HAIR_MACRO_GROUP_SHIFT)) >>>
    0
  const [tx, ty, tz] = sample.tangent
  out[2] =
    (hairUnitByte(tx * 0.5 + 0.5) |
      (hairUnitByte(ty * 0.5 + 0.5) << 8) |
      (hairUnitByte(tz * 0.5 + 0.5) << 16) |
      (Math.min(255, sample.coverage8) << 24)) >>>
    0
  const [r, g, b] = sample.baseColor
  out[3] =
    (hairUnitByte(Math.sqrt(r)) |
      (hairUnitByte(Math.sqrt(g)) << 8) |
      (hairUnitByte(Math.sqrt(b)) << 16) |
      (hairUnitByte(sample.roughness) << 24)) >>>
    0
  out[4] =
    (hairUnitByte(sample.specular) |
      (hairUnitByte(sample.backlit) << 8) |
      ((sample.flags & 0xff) << 16) |
      ((sample.lightChannels & 0x7) << 24)) >>>
    0
  return out
}

/** The sample five words hold. */
export function unpackHairSample(words: ArrayLike<number>): HairSample {
  const bytes = (word: number, at: number) => ((word >>> (8 * at)) & 0xff) / 255
  const depth = new DataView(Uint32Array.of(words[0]!).buffer).getFloat32(0, true)
  const colour = (at: number) => bytes(words[3]!, at) * bytes(words[3]!, at)
  return {
    depth,
    tangent: [0, 1, 2].map((at) => bytes(words[2]!, at) * 2 - 1) as [number, number, number],
    coverage8: words[2]! >>> 24,
    controlPoint: words[1]! & HAIR_CONTROL_POINT_MASK,
    macroGroup: words[1]! >>> HAIR_MACRO_GROUP_SHIFT,
    baseColor: [colour(0), colour(1), colour(2)],
    roughness: bytes(words[3]!, 3),
    specular: bytes(words[4]!, 0),
    backlit: bytes(words[4]!, 1),
    flags: (words[4]! >>> 16) & 0xff,
    lightChannels: words[4]! >>> 24,
  }
}

/** A node's depth from the 24 bits its visibility word holds above its coverage: the steps over the
 *  most a depth takes (`HAIR_DEPTH_SCALE`). */
export const unpackHairDepth = (word: number, scale: number) => Math.fround((word >>> 8) / scale)
