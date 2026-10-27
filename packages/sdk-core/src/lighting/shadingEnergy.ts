/**
 * THE GGX ENERGY TABLE of the shading, as data: for a view at cosine N·V and a lobe of perceptual roughness r, the
 * directional albedo of the GGX lobe under a Fresnel of one (`E`) and the share of it weighted by (1 − V·H)⁵ (`Ef`),
 * so that a lobe of reflectances F0 and F90 keeps `W · (E · F0 + Ef · (F90 − F0))` of the light, `W = 1 + F0 · (1 − E) / E`
 * restoring the energy its single scattering misses.
 *
 * Each texel of the 32 × 32 table is the mean, over 2¹⁴ points of a two-dimensional net, of the weight G2 / G1 of a half
 * vector drawn from the distribution of the normals the view sees (bounded, with the spherical caps), the light reflected
 * about it kept above the horizon: across N·V and down r, both at the texel's centre. The only column anything here reads is
 * the one a view along the normal reads, held below as the table's values (`shadingEnergy.fixture.ts` builds it, and its test
 * checks these values equal the builder's, bit for bit as 32-bit floats). It differs from the table of the environment BRDF
 * (`./environmentBrdf.ts`), whose shadowing is the joint approximation and whose half vectors follow the distribution alone:
 * that one's A + B and B tend to this table's `E` and `Ef` only as the approximation tends to the exact shadowing, so the two
 * are not interchangeable.
 */

/** Texels across (N·V) and down (roughness) of the table. */
export const SHADING_ENERGY_SIZE = 32

/**
 * The column of the table a view along the normal reads: N·V of one, which the clamped sampler takes at the centre of the
 * last texel across, so the lookup blends the rows alone. `SHADING_ENERGY_SIZE` pairs `[E, Ef]`, row after row, roughness
 * rising.
 */
export const SHADING_ENERGY_ALONG_NORMAL = new Float32Array([
  0.99999994, 9.31718702e-10, 0.999995828, 1.04618791e-9, 0.999967992, 1.60482365e-8, 0.999876857,
  2.18989129e-7, 0.999600768, 4.61719424e-7, 0.999159515, 0.00000150419078, 0.998137832,
  0.00000242826059, 0.99667269, 0.00000428950443, 0.99436748, 0.00000688497721, 0.990941584,
  0.0000102623571, 0.986057341, 0.0000144684855, 0.979345322, 0.000019520865, 0.970368266,
  0.0000254311417, 0.958636463, 0.0000319274295, 0.943737149, 0.0000388420231, 0.925287366,
  0.0000459443436, 0.902980626, 0.0000528279197, 0.876699626, 0.0000592873148, 0.846447587,
  0.0000649618087, 0.812453389, 0.000069658483, 0.775104821, 0.0000731910841, 0.734956026,
  0.00007548555, 0.692668736, 0.000076518314, 0.648978829, 0.000076355238, 0.604636788,
  0.0000751067928, 0.560364008, 0.0000729323438, 0.516814828, 0.0000700067758, 0.474550396,
  0.0000665101397, 0.434025615, 0.0000626160836, 0.395583451, 0.0000584808549, 0.359462172,
  0.0000542413763, 0.325802475, 0.0000500077622,
])
