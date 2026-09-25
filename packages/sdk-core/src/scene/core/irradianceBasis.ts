/**
 * The order-2 real spherical-harmonics basis, written once for every shader that projects
 * radiance onto it or evaluates irradiance from it: the scene environment, the WebGL2 light
 * probe and the bounce probes. Nine terms per colour channel, in the engine's band order —
 * constant, `y`, `z`, `x`, `xy`, `yz`, `3z² − 1`, `xz`, `x² − y²` (bands `l = 0, 1, 2`, `m`
 * ascending).
 *
 * A radiance `L(ω)` projects to `L_k = ∫ L(ω) · basis_k · polynomial_k(ω) dω`; the irradiance
 * at a normal is `E(n) = Σ L_k · band_k · polynomial_k(n)`, the cosine-lobe convolution of
 * Ramamoorthi and Hanrahan ("An Efficient Representation for Irradiance Environment Maps",
 * SIGGRAPH 2001, eq. 12–13): `band_k = Â_l · basis_k` with `Â_0 = π`, `Â_1 = 2π/3`, `Â_2 = π/4`.
 */
import { IRRADIANCE_BAND } from './environment.ts';

/** One term of the basis. */
export interface IrradianceTerm {
  /** Normalisation of the real harmonic: `Y_k(ω) = basis · polynomial(ω)`. */
  basis: number;
  /** Cosine-lobe factor `Â_l · basis`: the term's irradiance is `L_k · band · polynomial(n)`. */
  band: number;
  /** The polynomial in the components of a unit vector named `v`, as shader text valid in WGSL
   *  and GLSL alike. */
  polynomial: (v: string) => string;
}

const constant = 0.2820948,
  linear = 0.4886025,
  cross = 1.0925484;

/** The nine terms, in band order. */
export const IRRADIANCE_TERMS: readonly IrradianceTerm[] = [
  { basis: constant, band: IRRADIANCE_BAND.constant, polynomial: () => '1.0' },
  { basis: linear, band: IRRADIANCE_BAND.linear, polynomial: (v) => `${v}.y` },
  { basis: linear, band: IRRADIANCE_BAND.linear, polynomial: (v) => `${v}.z` },
  { basis: linear, band: IRRADIANCE_BAND.linear, polynomial: (v) => `${v}.x` },
  { basis: cross, band: IRRADIANCE_BAND.quadraticCross, polynomial: (v) => `${v}.x*${v}.y` },
  { basis: cross, band: IRRADIANCE_BAND.quadraticCross, polynomial: (v) => `${v}.y*${v}.z` },
  {
    basis: 0.3153916,
    band: IRRADIANCE_BAND.quadraticZ,
    polynomial: (v) => `3.0*${v}.z*${v}.z-1.0`,
  },
  { basis: cross, band: IRRADIANCE_BAND.quadraticCross, polynomial: (v) => `${v}.x*${v}.z` },
  {
    basis: 0.5462742,
    band: IRRADIANCE_BAND.quadraticDifference,
    polynomial: (v) => `${v}.x*${v}.x-${v}.y*${v}.y`,
  },
];

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
