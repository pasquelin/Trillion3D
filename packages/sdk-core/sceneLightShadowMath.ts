import { LIGHT_SETTINGS } from './sceneLightContracts.ts';

/** Plans proche et lointain d'une tranche, dérivés de la seule portée : une seule source pour la
 *  projection et pour le rejet, sinon les deux pourraient diverger d'un cheveu au bord. */
export function shadowPlanes(range: number) {
  const near = Math.max(LIGHT_SETTINGS.shadowNearMin, range * LIGHT_SETTINGS.shadowNearFraction);
  return { near, far: Math.max(near * 1.001, range) };
}

/**
 * Projection perspective pour l'espace de découpe WebGPU, profondeur normalisée dans `[0, 1]`,
 * colonne-major. `near` est dérivé de la portée : une seule constante, jamais un réglage caché.
 */
export function shadowProjection(out: Float32Array, base: number, fov: number, range: number) {
  const { near, far } = shadowPlanes(range),
    f = 1 / Math.tan(fov / 2),
    depth = far / (near - far);
  out.fill(0, base, base + 16);
  out[base] = f;
  out[base + 5] = f;
  out[base + 10] = depth;
  out[base + 11] = -1;
  out[base + 14] = near * depth;
  return { near, far, halfFov: fov / 2 };
}

/**
 * Projection orthographique d'une cascade, profondeur normalisée dans `[0, 1]`, colonne-major. Le
 * plan proche est à l'œil : celui-ci est déjà reculé vers la lampe de toute la profondeur voulue.
 */
export function shadowOrthographic(
  out: Float32Array,
  base: number,
  halfExtent: number,
  far: number,
) {
  out.fill(0, base, base + 16);
  out[base] = 1 / halfExtent;
  out[base + 5] = 1 / halfExtent;
  out[base + 10] = -1 / far;
  out[base + 15] = 1;
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
export const projScratch = new Float32Array(16);

/** Vue puis projection, composées dans `out` : le seul chemin par lequel une face obtient sa matrice. */
export function composeFace(
  out: Float32Array,
  base: number,
  eye: readonly [number, number, number],
  forward: readonly [number, number, number],
) {
  shadowView(viewScratch, 0, eye, forward);
  multiply4(out, base, projScratch, 0, viewScratch, 0, mulScratch);
}
