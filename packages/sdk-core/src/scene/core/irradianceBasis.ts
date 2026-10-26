/**
 * The order-2 real spherical-harmonics basis, written once for every shader that projects
 * radiance onto it or evaluates irradiance from it: the scene environment the lighting resolve
 * evaluates — its lights summed into the nine coefficients on the CPU, only when they change
 * (`addLightIrradiance`) — and the bounce probes, projected and evaluated in compute passes.
 * Nine terms per colour channel, in the engine's band order — constant, `y`, `z`, `x`, `xy`,
 * `yz`, `3z² − 1`, `xz`, `x² − y²` (bands `l = 0, 1, 2`, `m` ascending).
 *
 * A radiance `L(ω)` projects to `L_k = ∫ L(ω) · basis_k · polynomial_k(ω) dω`; the irradiance
 * at a normal is `E(n) = Σ L_k · band_k · polynomial_k(n)`, the convolution with the clamped
 * cosine lobe: `band_k = Â_l · basis_k` with `Â_0 = π`, `Â_1 = 2π/3`, `Â_2 = π/4`.
 */
import { IRRADIANCE_TERMS } from './irradianceTerms.ts'

/**
 * Irradiance at the unit normal named `normal`, as a shader expression: the sum of each
 * coefficient `coefficient(k)` (a three-component vector) times its band and polynomial. Not
 * clamped: a truncated basis can dip below zero where true irradiance cannot, and each caller
 * clamps. `terms` the first terms only, the constant and linear bands for four.
 */
export function irradianceShader(
  coefficient: (k: number) => string,
  normal: string,
  terms = IRRADIANCE_TERMS.length,
) {
  return IRRADIANCE_TERMS.slice(0, terms)
    .map((term, k) => `${coefficient(k)}*((${term.polynomial(normal)})*${term.band})`)
    .join('+')
}

/**
 * The nine harmonics of the unit direction named `direction`, as a shader expression of an `array<f32,9>`: each
 * term's normalisation times its polynomial. A radiance sample of a direction adds its colour times each factor to
 * the matching coefficient.
 */
export function harmonicsShader(direction: string) {
  const factors = IRRADIANCE_TERMS.map((term) => `${term.basis}*(${term.polynomial(direction)})`)
  return `array<f32,9>(${factors.join(',')})`
}

/**
 * The nine factors of the cosine lobe of the unit normal named `normal`, as a shader expression of an `array<f32,9>`:
 * each term's band times its polynomial, so that the irradiance is the sum of the coefficients times them
 * (`irradianceShader` writes the same sum, coefficient by coefficient).
 */
export function cosineLobeShader(normal: string) {
  const factors = IRRADIANCE_TERMS.map((term) => `${term.band}*(${term.polynomial(normal)})`)
  return `array<f32,9>(${factors.join(',')})`
}
