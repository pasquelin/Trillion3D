import { LIGHT_SETTINGS, POINT_FACES, type SceneLight } from './sceneLightContracts.ts';

/**
 * Les six axes d'une ponctuelle, dans l'ordre que le shader retrouve depuis l'axe majeur de la
 * direction lampe → point : +X, −X, +Y, −Y, +Z, −Z. L'ordre est le contrat, pas un détail.
 */
export const POINT_FACE_AXES: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];
/** Flottants d'une face dans le tampon de tranches : la matrice puis le rectangle d'atlas. */
export const SHADOW_FACE_FLOATS = 20;
/** Flottants d'une tranche : six faces plus un `vec4f` d'entête (faces, type, côté, pad). */
export const SHADOW_SLICE_FLOATS = POINT_FACES * SHADOW_FACE_FLOATS + 4;

/** Faces réellement dessinées pour une lampe : six pour une ponctuelle, une pour un projecteur. */
export const faceCountOf = (light: Pick<SceneLight, 'kind'>) =>
  light.kind === 'point' ? POINT_FACES : 1;

/** Demi-angle du cône élargi d'un demi-degré, pour que le bord du cône reste couvert par la carte. */
const spotFov = (coneAngle: number) => Math.min(Math.PI * 0.98, 2 * coneAngle + 0.0175);

/** Flottants du volume d'une face : centre et plan lointain, axe de la face et demi-angle. */
export const SHADOW_CULL_FLOATS = 8;
/**
 * Le volume qu'une face peut voir, sous forme de cône : la lampe pour sommet, l'axe de la face pour
 * direction, et le demi-angle du cône circonscrit au carré de la face — la diagonale du carré fait
 * `√2` fois son demi-côté, donc le cône qui l'englobe a pour tangente `√2·tan(fov/2)`.
 *
 * Un cluster dont la sphère monde ne touche ni la portée ni ce cône ne peut rien écrire dans la
 * face : la projection le rejetterait de toute façon au plan lointain ou aux plans latéraux. Le
 * rejet est donc exact, jamais une approximation de qualité — l'image ne change pas d'un texel.
 */
export function writeFaceCull(out: Float32Array, base: number, light: SceneLight, face: number) {
  const forward =
    light.kind === 'point' ? POINT_FACE_AXES[face] : (light.direction as [number, number, number]);
  const half = (light.kind === 'point' ? Math.PI / 2 : spotFov(light.coneAngle!)) / 2;
  const length = Math.hypot(forward[0], forward[1], forward[2]) || 1;
  out[base] = light.position[0];
  out[base + 1] = light.position[1];
  out[base + 2] = light.position[2];
  // Le plan lointain de la face, pas la portée : les deux ne coïncident que si la portée dépasse le
  // plan proche, et un cluster entre les deux doit rester dessiné.
  out[base + 3] = shadowPlanes(light.range).far;
  out[base + 4] = forward[0] / length;
  out[base + 5] = forward[1] / length;
  out[base + 6] = forward[2] / length;
  // Un demi-champ au-delà du quart de tour couvre déjà tout l'espace : le cône n'exclut plus rien.
  out[base + 7] = half >= Math.PI / 2 ? Math.PI : Math.atan(Math.SQRT2 * Math.tan(half));
}

/** Plans proche et lointain d'une tranche, dérivés de la seule portée : une seule source pour la
 *  projection et pour le rejet, sinon les deux pourraient diverger d'un cheveu au bord. */
function shadowPlanes(range: number) {
  const near = Math.max(LIGHT_SETTINGS.shadowNearMin, range * LIGHT_SETTINGS.shadowNearFraction);
  return { near, far: Math.max(near * 1.001, range) };
}

/**
 * Projection perspective pour l'espace de découpe WebGPU, profondeur normalisée dans `[0, 1]`,
 * colonne-major. `near` est dérivé de la portée : une seule constante, jamais un réglage caché.
 */
function shadowProjection(out: Float32Array, base: number, fov: number, range: number) {
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
  projScratch = new Float32Array(16),
  mulScratch = new Float32Array(16);

/**
 * Écrit la matrice vue-projection d'une face dans `out`, à l'emplacement de la face. Une ponctuelle
 * prend l'axe de `POINT_FACE_AXES` et 90° ; un projecteur prend sa direction et son cône élargi.
 */
export function writeFaceMatrix(out: Float32Array, base: number, light: SceneLight, face: number) {
  const forward =
    light.kind === 'point' ? POINT_FACE_AXES[face] : (light.direction as [number, number, number]);
  const fov = light.kind === 'point' ? Math.PI / 2 : spotFov(light.coneAngle!);
  shadowView(viewScratch, 0, light.position, forward);
  const planes = shadowProjection(projScratch, 0, fov, light.range);
  multiply4(out, base, projScratch, 0, viewScratch, 0, mulScratch);
  return planes;
}
