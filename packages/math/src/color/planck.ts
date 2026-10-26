/** The black body's locus in the CIE 1960 UCS plane, by the rational fit of six coefficients. */

/** The black body's chromaticity in the (u, v) plane at `t` kelvins, accurate from 1000 to 15000. */
export function planckianUv(t: number): readonly [number, number] {
  const u =
    (0.860117757 + 1.54118254e-4 * t + 1.28641212e-7 * t * t) /
    (1 + 8.42420235e-4 * t + 7.08145163e-7 * t * t)
  const v =
    (0.317398726 + 4.22806245e-5 * t + 4.20481691e-8 * t * t) /
    (1 - 2.89741816e-5 * t + 1.61456053e-7 * t * t)
  return [u, v]
}

/** The (u, v) point of the 1960 UCS plane as the chromaticity (x, y) of CIE 1931. */
export function chromaticityOfUv(u: number, v: number): readonly [number, number] {
  const d = 2 * u - 8 * v + 4
  return [(3 * u) / d, (2 * v) / d]
}
