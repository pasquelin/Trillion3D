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
 * clamps.
 */
export function irradianceShader(coefficient: (k: number) => string, normal: string) {
  return IRRADIANCE_TERMS.map(
    (term, k) => `${coefficient(k)}*((${term.polynomial(normal)})*${term.band})`,
  ).join('+')
}

/**
 * Radiance through a lobe of directions, as a shader expression: the lobe named `lobe` carries its
 * centre `R`, its long axis `T` (unit, across `R`, or zero) and `bands` (`ReflectionLobe`,
 * `reflectionLobeOf`). An order-2 radiance is a polynomial of degree two in the direction, so its
 * mean over the lobe needs the lobe's first two moments alone: E[ω] = bands.x · R, and
 * E[ωωᵀ] = E[z²] RRᵀ + σt² TTᵀ + σb² BBᵀ. Band 0 stays whole, band 1 is the harmonic at `R`
 * times `bands.x`, and band 2 — traceless forms, which a frame's three axes sum to zero over — is
 * the harmonic at `R` times `bands.y` plus the harmonic at `T` times `bands.z`. Not clamped, as
 * above.
 */
export function lobeRadianceShader(coefficient: (k: number) => string, lobe: string) {
  const at = (term: (typeof IRRADIANCE_TERMS)[number], axis: string) =>
    `(${term.polynomial(`${lobe}.${axis}`)})`
  return IRRADIANCE_TERMS.map((term, k) =>
    k === 0
      ? `${coefficient(k)}*${term.basis}`
      : k < 4
        ? `${coefficient(k)}*(${at(term, 'R')}*${term.basis}*${lobe}.bands.x)`
        : `${coefficient(k)}*((${at(term, 'R')}*${lobe}.bands.y+${at(term, 'T')}*${lobe}.bands.z)*${term.basis})`,
  ).join('+')
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
  ).join('\n')
}
