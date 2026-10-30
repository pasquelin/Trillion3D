import { toHalf } from '../../../../math/src/float/half.ts'
import { alignUp, nextPow2 } from '../../../../math/src/scalar/integers.ts'
import { GGX_MAX_SIZE } from '../ggxMaxSpec.ts'
import { sampleToonRamps, type ToonProfile } from './profile.ts'

/** The extinction of `profile`'s medium per centimetre, the unit of the shadow maps' occluder distance (the profile gives it per metre); the projection's view holds it by row (`toon/registry.ts`), no row of the toon buffer. */
export const toonShadowExtinction = (profile: ToonProfile) =>
  profile.shadowExtinctionCoefficient / 100

/**
 * WHAT THE LIGHTS READ OF A TOON PROFILE, as the toon buffer holds it (`packages/sdk-browser/src/lighting/toon/`): a row of
 * `rowWords` words a profile, then the patterns of the profiles that wear images, `patternWords` words a slot, for the resolution
 * `texels` the ramps are baked at (`toonProfileResolution`, `toonLayout`).
 * The row, in words: the diffuse ramp (`texels` texels, two words each: red and green, then blue, as half floats), the
 * specular ramp (the same), the shadow's distribution ramp (`texels` half floats, two a word, the first in the low half), the specular
 * indirect ramp (the same),
 * then the parameters (`TOON_PARAM`), each a 32-bit float but the slot, an integer. The ramps are read by the cosine as a texture
 * of `texels` texels is by a bilinear filter that clamps at the edge.
 */

/** The least resolution a toon profile is baked at, and the default one (the setting `toonProfileResolution`). */
export const TOON_PROFILE_RESOLUTION = 64
/** The profiles the toon buffer can hold: the id of a profile is held in 8 bits. */
export const TOON_PROFILE_ROWS = 256
/** The profiles that can wear images at once; the others have none. */
export const TOON_PATTERN_SLOTS = 16

/** The resolution the setting asks, held to the least (64) and to a multiple of 8, the bake's workgroup. */
export const toonResolutionOf = (asked: number) =>
  Math.max(TOON_PROFILE_RESOLUTION, alignUp(asked, 8))

/** The words of a row's parameters. */
export const TOON_PARAM = {
  diffuseOffsetStrength: 0,
  diffuseOffsetSize: 1,
  specularOffsetStrength: 2,
  specularOffsetSize: 3,
  /** 1 where the diffuse ramp's input includes the shadow. */
  rampIncludesShadow: 4,
  /** The profile's pattern slot plus one, an integer; 0 for none. */
  patternSlot: 5,
  shadowHatchSize: 6,
  shadowHatchStrength: 7,
  diffuseIndirectScale: 8,
  specularIndirectScale: 9,
  specularIndirectRampRepetition: 10,
  length: 12,
} as const

/** The layout of the rows and patterns at the resolution `texels` (a multiple of 8): where each part of a row starts, in words, and the words of a row and of a pattern slot. */
export function toonLayout(texels: number) {
  const params = texels * 5
  return {
    texels,
    /** The texels of a pattern that are the image: the bake keeps a ring of one texel around it, so that a repeating pattern filters across its seam. */
    bakeTexels: texels - 2,
    row: {
      diffuse: 0,
      specular: texels * 2,
      shadow: texels * 4,
      specularIndirect: texels * 4 + texels / 2,
      params,
    },
    rowWords: params + TOON_PARAM.length,
    /** Words of a pattern slot: the offsets' texels (diffuse in red, specular in green, 16 bits each), then the hatching's (four channels, 8 bits each),
     *  `texels` texels a side, row after row. */
    patternWords: 2 * texels * texels,
  }
}
export type ToonLayout = ReturnType<typeof toonLayout>

/**
 * THE TOON BUFFER, the one buffer the toon tables live in, sized from the profiles the materials hold (none: a header alone): a header of
 * `TOON_BUFFER_HEADER_WORDS` words (where the patterns start, in words; the resolution; the words of a row), the toon specular's peak table
 * (`ggxMaxSpec.ts`, two words a texel), the rows of the profiles (`rowCapacity` of them), then the patterns (`slotCapacity` of them). A capacity
 * is a power of two, so that a buffer is made again only when the profiles double.
 */
export const TOON_BUFFER_HEADER_WORDS = 4
/** Where the rows start, in words. */
export const TOON_ROWS_AT = TOON_BUFFER_HEADER_WORDS + GGX_MAX_SIZE * GGX_MAX_SIZE * 2
/** Where the patterns start, in words, for `rows` rows of capacity. */
export const toonPatternsAt = (layout: ToonLayout, rows: number) =>
  TOON_ROWS_AT + rows * layout.rowWords
/** The words of a toon buffer of `rows` rows and `slots` pattern slots of capacity; the header alone for no row. */
export const toonBufferWords = (layout: ToonLayout, rows: number, slots: number) =>
  rows === 0 ? TOON_BUFFER_HEADER_WORDS : toonPatternsAt(layout, rows) + slots * layout.patternWords
/** The capacity that holds `count`: the next power of two, none for none. */
export const toonCapacityFor = (count: number) => (count <= 0 ? 0 : nextPow2(count))

const pairOf = (a: number, b: number) => (toHalf(a) | (toHalf(b) << 16)) >>> 0

/**
 * The row of `profile`: its ramps sampled (`sampleToonRamps`) and its parameters. A strength of an offset or of the hatching is 0
 * where the profile has no image to apply it to. `slot` is the pattern slot its images take, or -1 for none.
 */
export function packToonRow(profile: ToonProfile, slot: number, layout: ToonLayout) {
  const { texels, row: at } = layout
  const row = new Uint32Array(layout.rowWords)
  const floats = new Float32Array(row.buffer)
  const { diffuse, specular, shadow, indirect } = sampleToonRamps(profile, texels)
  for (let i = 0; i < texels; i++) {
    for (const [ramp, start] of [
      [diffuse, at.diffuse],
      [specular, at.specular],
    ] as const) {
      row[start + i * 2] = pairOf(ramp[i * 3]!, ramp[i * 3 + 1]!)
      row[start + i * 2 + 1] = pairOf(ramp[i * 3 + 2]!, 0)
    }
    if (i % 2 === 0) {
      row[at.shadow + i / 2] = pairOf(shadow[i]!, shadow[i + 1]!)
      row[at.specularIndirect + i / 2] = pairOf(indirect[i]!, indirect[i + 1]!)
    }
  }
  const p = at.params
  floats[p + TOON_PARAM.diffuseOffsetStrength] = profile.diffuseRampOffsetTexture
    ? profile.diffuseRampOffsetStrength
    : 0
  floats[p + TOON_PARAM.diffuseOffsetSize] = profile.diffuseRampOffsetSize
  floats[p + TOON_PARAM.specularOffsetStrength] = profile.specularRampOffsetTexture
    ? profile.specularRampOffsetStrength
    : 0
  floats[p + TOON_PARAM.specularOffsetSize] = profile.specularRampOffsetSize
  floats[p + TOON_PARAM.rampIncludesShadow] = profile.diffuseRampIncludesShadow ? 1 : 0
  row[p + TOON_PARAM.patternSlot] = slot + 1
  floats[p + TOON_PARAM.shadowHatchSize] = profile.shadowHatchingPatternSize
  floats[p + TOON_PARAM.shadowHatchStrength] = profile.shadowHatchingPatternTexture
    ? profile.shadowHatchingPatternStrength
    : 0
  floats[p + TOON_PARAM.diffuseIndirectScale] = profile.diffuseIndirectScale
  floats[p + TOON_PARAM.specularIndirectScale] = profile.specularIndirectScale
  floats[p + TOON_PARAM.specularIndirectRampRepetition] = profile.specularIndirectRampRepetition
  return row
}
