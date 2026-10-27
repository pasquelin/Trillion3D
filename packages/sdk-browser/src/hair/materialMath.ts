import { saturate } from '../../../math/src/scalar/reals.ts'
import { HAIR_NODE_DATA_WORDS } from './visibilityMath.ts'

/**
 * THE MATERIAL OF A STRAND, in numbers: what the material pass (`materialPass.ts`) writes for each
 * compacted sample, and the twin of its packing the proofs and the passes after it read the words
 * by. A sample's material is five words (`HAIR_NODE_DATA_WORDS`):
 * 0. its depth, a float;
 * 1. its control point on the low 28 bits, its macro group on the high four;
 * 2. its tangent (`tangent * 0.5 + 0.5` a byte, three bytes) and its coverage of the pixel (a byte);
 * 3. the square root of its base colour (three bytes) and its roughness (a byte);
 * 4. its specular (a byte), its backlit share (a byte), its flags (a byte, `HAIR_FLAG`) and the
 *    lighting channels of its object (three bits).
 * The colour is kept as its square root for the precision of the darks. Bytes are `floor(x * 255)`.
 */

/** The bits of a sample's flags: the strands light the light that reaches the scene behind them, are
 *  drawn at the stable width, are traced as geometry, are held out of the image, cast a contact shadow. */
export const HAIR_FLAG = {
  scatterSceneLight: 0x1,
  stableRaster: 0x2,
  rayTracedGeometry: 0x4,
  holdout: 0x8,
  castContactShadow: 0x10,
} as const

/** What a group of strands is given where the file gives it none: the default values of the default strand
 *  material's colour (linear) and roughness parameters, the specular and backlit share the material
 *  inputs hold unconnected, and the lighting channel 0 an object is in by default (a mask of one bit). */
export const HAIR_DEFAULT_MATERIAL = {
  color: [0.2395, 0.1862, 0.10725],
  roughness: 0.333,
  specular: 0.5,
  backlit: 1,
  lightChannels: 1,
} as const

/** The bits of a sample's control point, and the macro groups a view holds at most. */
export const HAIR_CONTROL_POINT_MASK = 0x0fffffff
export const HAIR_MACRO_GROUP_SHIFT = 28
export const HAIR_MACRO_GROUP_MASK = 0xf

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
