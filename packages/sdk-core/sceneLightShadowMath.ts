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
  const up = Math.abs(fy) > 0.999 ? [0, 0, 1] : [0, 1, 0];
  let rx = fy * up[2] - fz * up[1],
    ry = fz * up[0] - fx * up[2],
    rz = fx * up[1] - fy * up[0];
  const rl = Math.hypot(rx, ry, rz) || 1;
  rx /= rl;
  ry /= rl;
  rz /= rl;
  const ux = ry * fz - rz * fy,
    uy = rz * fx - rx * fz,
    uz = rx * fy - ry * fx;
  out[base] = rx;
  out[base + 1] = ux;
  out[base + 2] = -fx;
  out[base + 3] = 0;
  out[base + 4] = ry;
  out[base + 5] = uy;
  out[base + 6] = -fy;
  out[base + 7] = 0;
  out[base + 8] = rz;
  out[base + 9] = uz;
  out[base + 10] = -fz;
  out[base + 11] = 0;
  out[base + 12] = -(rx * eye[0] + ry * eye[1] + rz * eye[2]);
  out[base + 13] = -(ux * eye[0] + uy * eye[1] + uz * eye[2]);
  out[base + 14] = fx * eye[0] + fy * eye[1] + fz * eye[2];
  out[base + 15] = 1;
}

/** `out[outBase..] = a · b`, matrices 4×4 colonne-major. Les trois tampons peuvent être le même. */
function multiply4(
  out: Float32Array,
  outBase: number,
  a: Float32Array,
  aBase: number,
  b: Float32Array,
  bBase: number,
  scratch: Float32Array,
) {
  for (let column = 0; column < 4; column++)
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[aBase + k * 4 + row] * b[bBase + column * 4 + k];
      scratch[column * 4 + row] = sum;
    }
  for (let i = 0; i < 16; i++) out[outBase + i] = scratch[i];
}

const viewScratch = new Float32Array(16),
  mulScratch = new Float32Array(16);

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
  multiply4(out, base, projScratch, 0, viewScratch, 0, mulScratch);
}
