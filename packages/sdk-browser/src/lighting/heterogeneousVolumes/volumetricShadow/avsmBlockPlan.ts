import { atlasWordsPerTexel, paddedTexels } from './volumetricShadowEncode.ts'

/** The words a block of the pack starts at a multiple of: what a storage binding's offset is aligned to (256 bytes). */
export const AVSM_BLOCK_ALIGN = 64
/** The words of a block before its indirection entries: the header of the shadow struct, padded to the alignment. */
export const AVSM_BLOCK_HEAD = AVSM_BLOCK_ALIGN

const alignUp = (words: number) => Math.ceil(words / AVSM_BLOCK_ALIGN) * AVSM_BLOCK_ALIGN

/** The layout of the block of an adaptive volumetric shadow map of `resolution` texels a side, `faces` and at most `maxSampleCount` samples a texel:
 *  the words of the indirection entries, where the atlas starts and the words in all. */
export function avsmBlockLayout(resolution: number, faces: number, maxSampleCount: number) {
  const texels = paddedTexels([resolution, resolution]) * faces
  const atlas = alignUp(AVSM_BLOCK_HEAD + texels * 4)
  return {
    texels,
    indirectionBytes: texels * 16,
    atlasStart: atlas,
    atlasBytes: texels * atlasWordsPerTexel(maxSampleCount) * 4,
    words: atlas + texels * atlasWordsPerTexel(maxSampleCount),
  }
}

/** The bytes the lists of a light's map take: a run of `maxSampleCount` entries of two words a texel. */
export const avsmListBytes = (resolution: number, faces: number, maxSampleCount: number) =>
  resolution * resolution * faces * maxSampleCount * 8

/**
 * The resolution the adaptive maps are made at: the requested one, halved while the lists of a light or the pack of all the lights' blocks
 * (`lightFaces` the faces of each light, `headerWords` the words before the first block) would not fit the largest binding the device allows.
 */
export function fitAvsmResolution(
  requested: number,
  lightFaces: readonly number[],
  maxSampleCount: number,
  maxBytes: number,
  headerWords: number,
) {
  let resolution = requested
  const fits = (r: number) =>
    lightFaces.every((faces) => avsmListBytes(r, faces, maxSampleCount) <= maxBytes) &&
    (alignUp(headerWords) +
      lightFaces.reduce((sum, faces) => sum + avsmBlockLayout(r, faces, maxSampleCount).words, 0)) *
      4 <=
      maxBytes
  while (resolution > 16 && !fits(resolution)) resolution = Math.floor(resolution / 2)
  return resolution
}
