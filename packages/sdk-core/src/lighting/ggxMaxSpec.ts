/**
 * THE GGX PEAK TABLE of the toon shading, as data: for a lobe of perceptual roughness r and anisotropy a, the share of the
 * lobe's highest value that the toon specular is multiplied by, so that the highlight of a toon surface reaches one at its
 * peak whatever its width. Each texel of the 32 × 32 table (roughness across, the absolute anisotropy down) holds four values, one
 * for each of four view cosines, 0, ⅓, ⅔ and 1: `1 / (π · max)`, held to [0, 1], of the lobe's value over the visible normals a view of that cosine
 * draws (`ggxMaxSpec.fixture.ts`, written to `ggxMaxSpecTable.ts`, whose test checks it equal to the builder, texel by texel).
 * The shading reads a texel at the roughness and anisotropy, bilinearly, and blends the four values by the view cosine's distance to each
 * (`GGX_MAX_VIEW_COSINES`, over `GGX_MAX_VIEW_STEP`), times π (`ggxMaxEnergy` of the fixture is the CPU twin of that read).
 */
import { unorm16 } from './environmentBrdf.ts'
import { GGX_MAX_SPEC_TABLE } from './ggxMaxSpecTable.ts'

/** Texels across (roughness) and down (anisotropy) of the table. */
export const GGX_MAX_SIZE = 32
/** The view cosines a texel holds a value for, and the width of the blend between two of them. */
export const GGX_MAX_VIEW_COSINES = [0, 0.3333, 0.6666, 1] as const
export const GGX_MAX_VIEW_STEP = 0.3333

let words: Uint32Array<ArrayBuffer> | null = null

/** The table's words for the light buffer, two a texel (the four values as 16-bit unsigned integers, the first in the low half of the first word), built once. */
export function ggxMaxSpecWords() {
  if (words) return words
  const packed = new Uint32Array(GGX_MAX_SIZE * GGX_MAX_SIZE * 2)
  for (let i = 0; i < packed.length; i++)
    packed[i] =
      (unorm16(GGX_MAX_SPEC_TABLE[i * 2]) | (unorm16(GGX_MAX_SPEC_TABLE[i * 2 + 1]) << 16)) >>> 0
  return (words = packed)
}
