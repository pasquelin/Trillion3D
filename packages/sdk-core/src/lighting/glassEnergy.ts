/**
 * THE GLASS ENERGY TABLE of the shading, as data: for a view at cosine N·V, a lobe of perceptual roughness r and a glass of index of
 * refraction n, the directional albedo of the rough dielectric interface (the light it reflects and refracts, the Fresnel term in the
 * density so cancelled) seen from outside (`in`: the index n) and from inside (`out`: the index 1 / n). The path tracer divides the
 * glass lobes by it, so that a rough glass keeps the energy its single scattering misses (the whole BSDF scaled by the lobe's albedo).
 *
 * The table is 32 × 32 × 32 texels, N·V across, roughness down, the index along the third axis over [1, 3] (a glass of more than 3
 * keeps the last layer); each texel is the mean, over 2¹⁴ points of an Owen-scrambled Sobol sequence (`../../../math/src/sequence/owenSobol.ts`)
 * of the texel, of the weight of the branch a ray takes at a visible-normal half vector, the reflectance of normal incidence that of the index
 * (`glassEnergy.fixture.ts` builds it and checks the data below against it). A pair `[in, out]` of unsigned 16-bit integers a texel.
 */
import { GLASS_ENERGY_BASE64 } from './glassEnergyTable.ts'

/** Texels along each axis of the table. */
export const GLASS_ENERGY_SIZE = 32

/** The index of refraction at the layer coordinate `z` in [0, 1]: the table covers [1, 3]. */
export const glassEnergyEta = (z: number) => 1 + 2 * z

let words: Uint32Array<ArrayBuffer> | null = null

/** The table's words for the light buffer, a word a texel (`in` in the low half, `out` in the high one), layer after layer, row after row, built once. */
export function glassEnergyWords() {
  if (words) return words
  const bytes = Uint8Array.from(atob(GLASS_ENERGY_BASE64), (c) => c.charCodeAt(0))
  if (bytes.length !== GLASS_ENERGY_SIZE ** 3 * 4)
    throw new RangeError(
      `glass energy table: ${bytes.length} bytes, not ${GLASS_ENERGY_SIZE ** 3 * 4}`,
    )
  return (words = new Uint32Array(bytes.buffer))
}
