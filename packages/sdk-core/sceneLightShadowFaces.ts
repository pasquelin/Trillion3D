import {
  LIGHT_SETTINGS,
  POINT_FACES,
  lightDirection,
  type SceneLight,
} from './sceneLightContracts.ts';
import {
  composeFace,
  projScratch,
  shadowPlanes,
  shadowProjection,
} from './sceneLightShadowMath.ts';
import { writeSunCull, writeSunMatrix } from './sceneLightSunFaces.ts';
import type { ShadowViewpoint } from './sceneLightSunCascades.ts';

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

/**
 * Faces réellement dessinées pour une lampe : six pour une ponctuelle, une pour un projecteur, et
 * les cascades pour une directionnelle — jamais plus que les six faces réservées par tranche.
 */
export function faceCountOf(kind: SceneLight['kind']) {
  switch (kind) {
    case 'point':
      return POINT_FACES;
    case 'directional':
      return Math.min(POINT_FACES, LIGHT_SETTINGS.sunCascades);
    default:
      return 1;
  }
}

/** Demi-angle du cône élargi d'un demi-degré, pour que le bord du cône reste couvert par la carte. */
const spotFov = (coneAngle: number) => Math.min(Math.PI * 0.98, 2 * coneAngle + 0.0175);

/**
 * L'axe et le champ vertical d'une face : l'axe fixe d'une ponctuelle et son quart de tour, ou la
 * direction du projecteur et son cône élargi. La matrice de la face et le volume que le rejet lui
 * oppose partent tous deux d'ici, sinon les deux pourraient viser des directions différentes.
 */
function faceAim(light: SceneLight, face: number) {
  const forward = light.kind === 'point' ? POINT_FACE_AXES[face] : lightDirection(light);
  return { forward, fov: light.kind === 'point' ? Math.PI / 2 : spotFov(light.coneAngle!) };
}

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
 *
 * Une cascade du soleil n'a pas de sommet : son volume est la sphère de sa boîte (`writeSunCull`).
 */
export function writeFaceCull(
  out: Float32Array,
  base: number,
  light: SceneLight,
  face: number,
  view: ShadowViewpoint,
  side: number,
) {
  if (light.kind === 'directional') return writeSunCull(out, base, light, face, view, side);
  const { forward, fov } = faceAim(light, face);
  const half = fov / 2;
  const length = Math.hypot(forward[0], forward[1], forward[2]) || 1;
  out[base] = light.position![0];
  out[base + 1] = light.position![1];
  out[base + 2] = light.position![2];
  // Le plan lointain de la face, pas la portée : les deux ne coïncident que si la portée dépasse le
  // plan proche, et un cluster entre les deux doit rester dessiné.
  out[base + 3] = shadowPlanes(light.range!).far;
  out[base + 4] = forward[0] / length;
  out[base + 5] = forward[1] / length;
  out[base + 6] = forward[2] / length;
  // Un demi-champ au-delà du quart de tour couvre déjà tout l'espace : le cône n'exclut plus rien.
  out[base + 7] = half >= Math.PI / 2 ? Math.PI : Math.atan(Math.SQRT2 * Math.tan(half));
}

/**
 * Écrit la matrice vue-projection d'une face dans `out`, à l'emplacement de la face. Une ponctuelle
 * prend l'axe de `POINT_FACE_AXES` et 90° ; un projecteur prend sa direction et son cône élargi ;
 * une directionnelle prend la cascade `face`, qui suit la caméra.
 */
export function writeFaceMatrix(
  out: Float32Array,
  base: number,
  light: SceneLight,
  face: number,
  view: ShadowViewpoint,
  side: number,
) {
  if (light.kind === 'directional') return writeSunMatrix(out, base, light, face, view, side);
  const { forward, fov } = faceAim(light, face);
  const planes = shadowProjection(projScratch, 0, fov, light.range!);
  composeFace(out, base, light.position!, forward);
  return planes;
}
