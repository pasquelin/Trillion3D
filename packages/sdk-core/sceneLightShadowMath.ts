import { multiplyMatrix4 } from './mathMatrix4.ts';
import { crossVector3, dotVector3 } from './mathVector.ts';
import { LIGHT_SETTINGS } from './sceneLightContracts.ts';

const projScratch = new Float32Array(16);
/** Plans d'une face et demi-champ de sa projection. Un seul est vivant à la fois : l'appelant le lit
 *  avant de composer la face suivante, donc l'objet est réutilisé et rien n'est alloué par image. */
const planes = { near: 0, far: 0, halfFov: 0 };

/**
 * Projection perspective pour l'espace de découpe WebGPU, profondeur normalisée dans `[0, 1]`,
 * colonne-major, écrite dans le tampon rendu. `near` est dérivé de la seule portée : une seule
 * source pour la projection et pour le rejet, sinon les deux pourraient diverger d'un cheveu au
 * bord, et jamais un réglage caché.
 */
export function shadowProjection(fov: number, range: number) {
  const near = Math.max(LIGHT_SETTINGS.shadowNearMin, range * LIGHT_SETTINGS.shadowNearFraction),
    far = Math.max(near * 1.001, range);
  const f = 1 / Math.tan(fov / 2),
    depth = far / (near - far);
  projScratch.fill(0);
  projScratch[0] = f;
  projScratch[5] = f;
  projScratch[10] = depth;
  projScratch[11] = -1;
  projScratch[14] = near * depth;
  planes.near = near;
  planes.far = far;
  planes.halfFov = fov / 2;
  return planes;
}

/**
 * Projection orthographique d'une cascade, profondeur normalisée dans `[0, 1]`, colonne-major. Le
 * plan proche est à l'œil : celui-ci est déjà reculé vers la lampe de toute la profondeur voulue.
 * Une orthographie n'a ni plan proche ni ouverture à publier : les deux sortent nuls.
 */
export function shadowOrthographic(halfExtent: number, far: number) {
  projScratch.fill(0);
  projScratch[0] = 1 / halfExtent;
  projScratch[5] = 1 / halfExtent;
  projScratch[10] = -1 / far;
  projScratch[15] = 1;
  planes.near = 0;
  planes.far = far;
  planes.halfFov = 0;
  return planes;
}

/**
 * Le repère monde de la dernière face composée : droite, haut, avant. C'est ce qui permet de porter
 * un rectangle de la carte — une région de pages — dans le monde sans recalculer le repère ailleurs,
 * donc sans qu'une seconde copie puisse diverger de celle-ci.
 */
export const faceBasis = new Float64Array(9);

/** Axes de repère haut : `y` en général, `z` quand la direction lui est presque parallèle. */
const UP_Y = [0, 1, 0] as const,
  UP_Z = [0, 0, 1] as const;
const right = new Float64Array(3),
  upward = new Float64Array(3);

/** Matrice de vue colonne-major d'une caméra en `eye` regardant le long de `forward`. */
function shadowView(
  out: Float32Array,
  base: number,
  eye: readonly [number, number, number],
  forward: readonly [number, number, number],
) {
  const fx = forward[0],
    fy = forward[1],
    fz = forward[2];
  // Un axe de repère parallèle à la direction ferait un produit vectoriel nul : on bascule l'axe haut.
  crossVector3(right, forward, Math.abs(fy) > 0.999 ? UP_Z : UP_Y);
  const rl = Math.hypot(right[0], right[1], right[2]) || 1;
  right[0] /= rl;
  right[1] /= rl;
  right[2] /= rl;
  crossVector3(upward, right, forward);
  for (let axis = 0; axis < 3; axis++) {
    faceBasis[axis] = right[axis];
    faceBasis[3 + axis] = upward[axis];
    faceBasis[6 + axis] = forward[axis];
  }
  out[base] = right[0];
  out[base + 1] = upward[0];
  out[base + 2] = -fx;
  out[base + 3] = 0;
  out[base + 4] = right[1];
  out[base + 5] = upward[1];
  out[base + 6] = -fy;
  out[base + 7] = 0;
  out[base + 8] = right[2];
  out[base + 9] = upward[2];
  out[base + 10] = -fz;
  out[base + 11] = 0;
  out[base + 12] = -dotVector3(right, eye);
  out[base + 13] = -dotVector3(upward, eye);
  out[base + 14] = dotVector3(forward, eye);
  out[base + 15] = 1;
}

const viewScratch = new Float32Array(16);

/**
 * Vue puis projection, composées dans `out` : le seul chemin par lequel une face obtient sa matrice.
 * La projection est celle que `shadowProjection` ou `shadowOrthographic` vient d'écrire.
 */
export function composeFace(
  out: Float32Array,
  base: number,
  eye: readonly [number, number, number],
  forward: readonly [number, number, number],
) {
  shadowView(viewScratch, 0, eye, forward);
  multiplyMatrix4(out, projScratch, viewScratch, base);
}
