/** The thresholds of the transport algorithm (`LIGHTING_TRANSPORT_ALGORITHM_VERSION`). */
export const LIGHTING_TRANSPORT_LIMITS = {
  /** The smallest Gram determinant `|u|²|v|² − (u·v)²` of a rectangle; below it, it has no area. */
  degenerateGram: 1e-15,
  /** The smallest `|(u × v) · direction|` of a ray meeting a surface (a cosine scaled by its
   *  area); below it, the ray runs along the surface. */
  grazing: 1e-12,
  /** The smallest pivot of a system the oracle solves; below it, the system is singular. */
  singularPivot: 1e-14,
} as const;
