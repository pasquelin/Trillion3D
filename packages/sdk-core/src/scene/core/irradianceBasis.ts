/**
 * The order-2 real spherical-harmonics basis, written once for every shader that projects
 * radiance onto it or evaluates irradiance from it: the scene environment, the WebGL2 light
 * probe and the bounce probes. Nine terms per colour channel, in the engine's band order —
 * constant, `y`, `z`, `x`, `xy`, `yz`, `3z² − 1`, `xz`, `x² − y²` (bands `l = 0, 1, 2`, `m`
 * ascending).
 *
 * A radiance `L(ω)` projects to `L_k = ∫ L(ω) · basis_k · polynomial_k(ω) dω`; the irradiance
 * at a normal is `E(n) = Σ L_k · band_k · polynomial_k(n)`, the convolution with the clamped
 * cosine lobe: `band_k = Â_l · basis_k` with `Â_0 = π`, `Â_1 = 2π/3`, `Â_2 = π/4`.
 */
import { IRRADIANCE_TERMS } from './irradianceTerms.ts';

/**
 * Irradiance at the unit normal named `normal`, as a shader expression: the sum of each
 * coefficient `coefficient(k)` (a three-component vector) times its band and polynomial. Not
 * clamped: a truncated basis can dip below zero where true irradiance cannot, and each caller
 * clamps.
 */
export function irradianceShader(coefficient: (k: number) => string, normal: string) {
  return IRRADIANCE_TERMS.map(
    (term, k) => `${coefficient(k)}*((${term.polynomial(normal)})*${term.band})`,
  ).join('+');
}

/**
 * Radiance along the unit direction named `direction`, convolved with a zonal lobe: each
 * coefficient times its harmonic, band `l` scaled by the component `x`, `y` or `z` of the vector
 * named `bands` (a GGX lobe's zonal moments, `reflectionProbeBands`). Not clamped, as above.
 */
export function filteredRadianceShader(
  coefficient: (k: number) => string,
  direction: string,
  bands: string,
) {
  return IRRADIANCE_TERMS.map(
    (term, k) =>
      `${coefficient(k)}*((${term.polynomial(direction)})*${term.basis}*${bands}.${k === 0 ? 'x' : k < 4 ? 'y' : 'z'})`,
  ).join('+');
}

/**
 * The statements that add one radiance sample `radiance`, arriving from the unit direction named
 * `direction`, to the nine accumulators `target(k)`: each takes the radiance times its harmonic.
 * The caller scales the sums by the quadrature weight (`4π / samples` for a uniform sphere).
 */
export function radianceProjectionShader(
  target: (k: number) => string,
  radiance: string,
  direction: string,
) {
  return IRRADIANCE_TERMS.map(
    (term, k) => `${target(k)}+=${radiance}*((${term.polynomial(direction)})*${term.basis});`,
  ).join('\n');
}
