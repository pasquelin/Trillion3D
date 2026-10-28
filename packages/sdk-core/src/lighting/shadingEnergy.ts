/**
 * THE GGX ENERGY TABLE of the shading, as data: for a view at cosine N·V and a lobe of perceptual roughness r, the
 * directional albedo of the GGX lobe under a Fresnel of one (`E`) and the share of it weighted by (1 − V·H)⁵ (`Ef`),
 * so that a lobe of reflectances F0 and F90 keeps `W · (E · F0 + Ef · (F90 − F0))` of the light, `W = 1 + F0 · (1 − E) / E`
 * restoring the energy its single scattering misses.
 *
 * Each texel of the 32 × 32 table is the mean, over 2¹⁴ points of an Owen-scrambled Sobol sequence (`../../../math/src/sequence/owenSobol.ts`),
 * of the weight G2 / G1 of a half vector drawn from the distribution of the normals the view sees (bounded, with the spherical
 * caps), the light reflected about it kept above the horizon: across N·V and down r, both at the texel's centre. The table is
 * data (`shadingEnergyTable.ts`, written by `shadingEnergy.fixture.ts`, whose test checks it equal to the builder, bit for bit as
 * 32-bit floats). It differs from the table of the environment BRDF (`./environmentBrdf.ts`), whose shadowing is the joint
 * approximation and whose half vectors follow the distribution alone: that one's A + B and B tend to this table's `E` and `Ef` only
 * as the approximation tends to the exact shadowing, so the two are not interchangeable. The environment lights read this one;
 * the water, which the environment BRDF weighs, the other.
 */
import { unorm16 } from './environmentBrdf.ts'
import { SHADING_ENERGY_TABLE } from './shadingEnergyTable.ts'

/** Texels across (N·V) and down (roughness) of the table. */
export const SHADING_ENERGY_SIZE = 32

/** The table: a pair `[E, Ef]` a texel, a row of `SHADING_ENERGY_SIZE` N·V a roughness, roughness rising. */
export { SHADING_ENERGY_TABLE }

/**
 * The column of the table a view along the normal reads: N·V of one, which the clamped sampler takes at the centre of the
 * last texel across, so the lookup blends the rows alone. `SHADING_ENERGY_SIZE` pairs `[E, Ef]`, row after row, roughness
 * rising.
 */
export const SHADING_ENERGY_ALONG_NORMAL = Float32Array.from(
  { length: SHADING_ENERGY_SIZE * 2 },
  (_, i) =>
    SHADING_ENERGY_TABLE[
      (Math.floor(i / 2) * SHADING_ENERGY_SIZE + SHADING_ENERGY_SIZE - 1) * 2 + (i % 2)
    ],
)

let words: Uint32Array<ArrayBuffer> | null = null

/** The table's words for the light buffer, a word a texel (`E` in the low half, `Ef` in the high one, 16-bit unsigned integers), built once. */
export function shadingEnergyWords() {
  if (words) return words
  const packed = new Uint32Array(SHADING_ENERGY_SIZE * SHADING_ENERGY_SIZE)
  for (let i = 0; i < packed.length; i++)
    packed[i] =
      (unorm16(SHADING_ENERGY_TABLE[i * 2]) | (unorm16(SHADING_ENERGY_TABLE[i * 2 + 1]) << 16)) >>>
      0
  return (words = packed)
}
