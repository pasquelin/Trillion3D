import { coneRejects } from '../projectionOracles.ts';

/**
 * Cone rejection tolerances, shared by the processor mirror (`packages/sdk-browser/src/page/cone/cone.ts`) and the shader
 * (`packages/sdk-browser/src/gpu/dag/shader/shader.ts`): a transformation is conformal when its columns have the same length within
 * `CONE_LENGTH_RATIO` and are orthogonal within `CONE_ORTHO_EPS`, relatively; a cone with angle
 * ≥ `HALF_PI` never rejects. The `_WGSL` variants are the text inserted into the shader, like
 * `SINGULAR_DETERMINANT_WGSL` (`../matrix/singular.ts`).
 */
export const CONE_LENGTH_RATIO = 1.0001;
/** How far from square two columns may be and still count as square. */
export const CONE_ORTHO_EPS = 1e-4;
/** A quarter turn, in radians. */
export const HALF_PI = Math.PI / 2;
/** `CONE_LENGTH_RATIO` as shader text. */
export const CONE_LENGTH_RATIO_WGSL = CONE_LENGTH_RATIO.toString();
/** `CONE_ORTHO_EPS` as shader text. */
export const CONE_ORTHO_EPS_WGSL = CONE_ORTHO_EPS.toExponential();
/** `HALF_PI` as shader text. */
export const HALF_PI_WGSL = HALF_PI.toString();

/**
 * Half-angle under which a sphere is seen from a homogeneous view point `(p, w)`: `asin(r / d)`,
 * clamped to [0, 1] before arcsine, for a point (w = 1); 0 for a direction (w = 0, an
 * orthographic camera sees every point of the sphere along the same line). A point inside the
 * sphere, or a NaN distance, sees it from everywhere: π.
 */
function sphereSpreadAngle(
  cx: number,
  cy: number,
  cz: number,
  radius: number,
  px: number,
  py: number,
  pz: number,
  pw: number,
) {
  const d = Math.hypot(px - cx * pw, py - cy * pw, pz - cz * pw);
  if (!(d > radius * pw)) return Math.PI;
  const t = (radius * pw) / d;
  return Math.asin(t < 0 ? 0 : t > 1 ? 1 : t);
}

/**
 * Rejection of a local box by its normal cone, viewed from a world point.
 *
 * The box is replaced by its sphere: center `(min + max) * 0.5` transformed by `world`
 * (4x4 column-major, homogeneous division), radius `hypot((max - min) * 0.5) * scale` — the scale
 * of a conformal transformation. The cone axis passes through `normal` (3x3 column-major, the normal
 * matrix of `world`) and is then normalized; a zero axis or view direction does not reject.
 * The verdict is `coneRejects` of the clamped dot product, the cone angle, and the sphere's
 * perspective spread; a parameter it refuses does not reject either.
 *
 * The camera is one homogeneous view point `eye` (`EngineCamera.viewPoint`): its position and 1
 * under a perspective projection, the direction back to it and 0 under an orthographic one. The
 * vector toward the camera is `eye.xyz − centre·eye.w` in both, one formula for both.
 */
export function boxConeRejects(
  axis: ArrayLike<number>,
  angle: number,
  min: ArrayLike<number>,
  max: ArrayLike<number>,
  world: ArrayLike<number>,
  normal: ArrayLike<number>,
  scale: number,
  eyeX: number,
  eyeY: number,
  eyeZ: number,
  eyeW = 1,
) {
  const e = world;
  const lx = (min[0] + max[0]) * 0.5,
    ly = (min[1] + max[1]) * 0.5,
    lz = (min[2] + max[2]) * 0.5;
  const w = 1 / (e[3] * lx + e[7] * ly + e[11] * lz + e[15]);
  const cx = (e[0] * lx + e[4] * ly + e[8] * lz + e[12]) * w,
    cy = (e[1] * lx + e[5] * ly + e[9] * lz + e[13]) * w,
    cz = (e[2] * lx + e[6] * ly + e[10] * lz + e[14]) * w;
  const radius =
    Math.hypot((max[0] - min[0]) * 0.5, (max[1] - min[1]) * 0.5, (max[2] - min[2]) * 0.5) * scale;
  const spread = sphereSpreadAngle(cx, cy, cz, radius, eyeX, eyeY, eyeZ, eyeW);
  const a0 = axis[0],
    a1 = axis[1],
    a2 = axis[2];
  let ax = normal[0] * a0 + normal[3] * a1 + normal[6] * a2,
    ay = normal[1] * a0 + normal[4] * a1 + normal[7] * a2,
    az = normal[2] * a0 + normal[5] * a1 + normal[8] * a2;
  const al = Math.sqrt(ax * ax + ay * ay + az * az);
  if (!(al > 0)) return false;
  const inverse = 1 / al;
  ax *= inverse;
  ay *= inverse;
  az *= inverse;
  const vx = eyeX - cx * eyeW,
    vy = eyeY - cy * eyeW,
    vz = eyeZ - cz * eyeW;
  const vl = Math.hypot(vx, vy, vz);
  if (!(vl > 0)) return false;
  const dot = Math.min(1, Math.max(-1, (ax * vx + ay * vy + az * vz) / vl));
  try {
    return coneRejects(dot, angle, spread);
  } catch {
    return false;
  }
}
