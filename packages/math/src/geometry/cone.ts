/**
 * Cone rejection tolerances, shared by the processor mirror and the shader: a transformation is conformal when its columns have the same length within
 * `CONE_LENGTH_RATIO` and are orthogonal within `CONE_ORTHO_EPS`, relatively; a cone with angle
 * ≥ `HALF_PI` never rejects.
 */
export const CONE_LENGTH_RATIO = 1.0001
/** How far from square two columns may be and still count as square. */
export const CONE_ORTHO_EPS = 1e-4
