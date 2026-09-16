import { coneRejects } from './projectionOracles.ts';

/**
 * Tolérances du rejet de cône, partagées par le miroir processeur (`pageCone.ts`) et le nuanceur
 * (`gpuDagShader.ts`) : une transformation est conforme quand ses colonnes ont la même longueur à
 * `CONE_LENGTH_RATIO` près et sont orthogonales à `CONE_ORTHO_EPS` près, en relatif ; un cône d'angle
 * ≥ `HALF_PI` ne rejette jamais. Les variantes `_WGSL` sont le texte inséré dans le nuanceur, comme
 * `SINGULAR_DETERMINANT_WGSL` (`mathSingular.ts`).
 */
export const CONE_LENGTH_RATIO = 1.0001;
export const CONE_ORTHO_EPS = 1e-4;
export const HALF_PI = Math.PI / 2;
export const CONE_LENGTH_RATIO_WGSL = CONE_LENGTH_RATIO.toString();
export const CONE_ORTHO_EPS_WGSL = CONE_ORTHO_EPS.toExponential();
export const HALF_PI_WGSL = HALF_PI.toString();

/**
 * Demi-angle sous lequel une sphère est vue depuis un point : `asin(r / d)`, borné à [0, 1] avant
 * l'arc sinus. Un point dans la sphère, ou une distance NaN, la voit de partout : π.
 */
function sphereSpreadAngle(
  cx: number,
  cy: number,
  cz: number,
  radius: number,
  px: number,
  py: number,
  pz: number,
) {
  const d = Math.hypot(px - cx, py - cy, pz - cz);
  if (!(d > radius)) return Math.PI;
  const t = radius / d;
  return Math.asin(t < 0 ? 0 : t > 1 ? 1 : t);
}

/**
 * Rejet d'une boîte locale par son cône de normales, vu d'un point du monde.
 *
 * La boîte est remplacée par sa sphère : centre `(min + max) * 0.5` transformé par `world`
 * (4×4 colonne-major, division homogène), rayon `hypot((max − min) * 0.5) * scale` — l'échelle
 * d'une transformation conforme. L'axe du cône passe par `normal` (3×3 colonne-major, la matrice
 * normale de `world`) puis est normalisé ; un axe ou une direction de vue nuls ne rejettent pas.
 * Le verdict est `coneRejects` du produit scalaire borné, de l'angle du cône et de l'étalement
 * perspectif de la sphère ; un paramètre qu'il refuse ne rejette pas non plus.
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
  const spread = sphereSpreadAngle(cx, cy, cz, radius, eyeX, eyeY, eyeZ);
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
  const vx = eyeX - cx,
    vy = eyeY - cy,
    vz = eyeZ - cz;
  const vl = Math.hypot(vx, vy, vz);
  if (!(vl > 0)) return false;
  const dot = Math.min(1, Math.max(-1, (ax * vx + ay * vy + az * vz) / vl));
  try {
    return coneRejects(dot, angle, spread);
  } catch {
    return false;
  }
}
