import { dotVector3 } from './mathVector.ts';
import { faceBasis } from './sceneLightShadowMath.ts';

/**
 * Le rectangle d'une région, en coordonnées normalisées de la face : `u0, u1, v0, v1`. La face
 * entière est `−1, 1, −1, 1`, et le volume qu'elle produit est alors exactement celui d'avant ce
 * lot : le cône circonscrit au carré, ou la sphère circonscrite à la boîte de la cascade.
 */
export const FULL_FACE = new Float64Array([-1, 1, -1, 1]);

const axis = new Float64Array(3),
  corner = new Float64Array(3);

/** Direction monde du point `(u, v)` du plan de projection, repère de la dernière face composée. */
function direction(out: Float64Array, u: number, v: number, t: number) {
  let length = 0;
  for (let a = 0; a < 3; a++) {
    out[a] = faceBasis[6 + a] + t * (u * faceBasis[a] + v * faceBasis[3 + a]);
    length += out[a] * out[a];
  }
  length = Math.sqrt(length) || 1;
  for (let a = 0; a < 3; a++) out[a] /= length;
}

/**
 * Le cône que le rejet oppose à une région d'une face en perspective : la lampe pour sommet, la
 * direction du centre de la région pour axe, et l'angle du plus écarté de ses quatre coins pour
 * demi-angle.
 *
 * C'est exact, jamais une approximation de qualité : l'image projetée d'un rectangle plan est
 * sphériquement convexe, donc la calotte qui contient ses quatre coins contient tout le rectangle.
 * Un cluster écarté ne pouvait rien écrire dans la région, et la région sort texel pour texel comme
 * si tous les clusters lui avaient été présentés.
 */
export function writeConeVolume(
  cull: Float32Array,
  base: number,
  position: readonly number[],
  far: number,
  halfFov: number,
  rect: Float64Array,
) {
  cull[base] = position[0];
  cull[base + 1] = position[1];
  cull[base + 2] = position[2];
  cull[base + 3] = far;
  // Un demi-champ au-delà du quart de tour couvre déjà tout l'espace : le cône n'exclut plus rien.
  if (halfFov >= Math.PI / 2) {
    cull[base + 4] = faceBasis[6];
    cull[base + 5] = faceBasis[7];
    cull[base + 6] = faceBasis[8];
    cull[base + 7] = Math.PI;
    return;
  }
  const t = Math.tan(halfFov);
  direction(axis, (rect[0] + rect[1]) / 2, (rect[2] + rect[3]) / 2, t);
  let cosine = 1;
  for (let index = 0; index < 4; index++) {
    direction(corner, index & 1 ? rect[1] : rect[0], index & 2 ? rect[3] : rect[2], t);
    const dot = dotVector3(axis, corner);
    if (dot < cosine) cosine = dot;
  }
  cull[base + 4] = axis[0];
  cull[base + 5] = axis[1];
  cull[base + 6] = axis[2];
  cull[base + 7] = Math.acos(Math.max(-1, Math.min(1, cosine)));
}

/**
 * La sphère que le rejet oppose à une région d'une cascade. Une orthographie n'a pas de sommet : la
 * région y découpe une sous-boîte de la boîte de la cascade, décalée dans le plan de la carte de la
 * part que la région occupe, et la sphère qui la circonscrit est le volume. Demi-angle π : le rejet
 * ne fait que le test de distance, comme pour la cascade entière.
 */
export function writeSphereVolume(
  cull: Float32Array,
  base: number,
  boxCenter: readonly number[],
  radius: number,
  halfDepth: number,
  rect: Float64Array,
) {
  const u = ((rect[0] + rect[1]) / 2) * radius,
    v = ((rect[2] + rect[3]) / 2) * radius;
  for (let a = 0; a < 3; a++)
    cull[base + a] = boxCenter[a] + faceBasis[a] * u + faceBasis[3 + a] * v;
  cull[base + 3] = Math.hypot(
    ((rect[1] - rect[0]) / 2) * radius,
    ((rect[3] - rect[2]) / 2) * radius,
    halfDepth,
  );
  cull[base + 4] = 0;
  cull[base + 5] = 1;
  cull[base + 6] = 0;
  cull[base + 7] = Math.PI;
}

/** Le rectangle normalisé d'une région de pages dans sa face : `y` descend dans le cadre de dessin. */
export function regionRect(
  out: Float64Array,
  rows: number,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
) {
  out[0] = (2 * x0) / rows - 1;
  out[1] = (2 * (x1 + 1)) / rows - 1;
  out[2] = 1 - (2 * (y1 + 1)) / rows;
  out[3] = 1 - (2 * y0) / rows;
  return out;
}
