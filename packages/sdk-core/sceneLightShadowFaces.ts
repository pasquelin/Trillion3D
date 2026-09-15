import {
  LIGHT_KIND,
  LIGHT_SETTINGS,
  POINT_FACES,
  lightDirection,
  type SceneLight,
  type ShadowViewpoint,
} from './sceneLightContracts.ts';
import { composeFace, shadowProjection } from './sceneLightShadowMath.ts';
import { writeSunFace } from './sceneLightSunFaces.ts';

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
export function faceCountOf(rank: number) {
  if (rank === LIGHT_KIND.point) return POINT_FACES;
  if (rank === LIGHT_KIND.directional) return Math.min(POINT_FACES, LIGHT_SETTINGS.sunCascades);
  return 1;
}

/** Demi-angle du cône élargi d'un demi-degré, pour que le bord du cône reste couvert par la carte. */
const spotFov = (coneAngle: number) => Math.min(Math.PI * 0.98, 2 * coneAngle + 0.0175);

/** Flottants du volume d'une face : centre et plan lointain, axe de la face et demi-angle. */
export const SHADOW_CULL_FLOATS = 8;

/**
 * Écrit la matrice vue-projection d'une face à son emplacement dans `matrices`, et, si le rejet est
 * armé, le volume que celui-ci lui oppose dans `cull`. Les deux partent du même axe et du même champ
 * — un seul calcul, donc aucun risque qu'ils visent des directions différentes. Une ponctuelle prend
 * l'axe de `POINT_FACE_AXES` et 90° ; un projecteur prend sa direction et son cône élargi ; une
 * directionnelle prend la cascade `face`, qui suit la caméra.
 *
 * Le volume est un cône : la lampe pour sommet, l'axe de la face pour direction, et le demi-angle du
 * cône circonscrit au carré de la face — la diagonale du carré fait `√2` fois son demi-côté, donc le
 * cône qui l'englobe a pour tangente `√2·tan(fov/2)`. Un cluster dont la sphère monde ne touche ni la
 * portée ni ce cône ne peut rien écrire dans la face : la projection le rejetterait de toute façon au
 * plan lointain ou aux plans latéraux. Le rejet est donc exact, jamais une approximation de qualité —
 * l'image ne change pas d'un texel. Une cascade du soleil n'a pas de sommet : son volume est la
 * sphère de sa boîte (`writeSunFace`).
 */
export function writeFace(
  matrices: Float32Array,
  matBase: number,
  cull: Float32Array | null,
  cullBase: number,
  light: SceneLight,
  face: number,
  view: ShadowViewpoint,
  side: number,
) {
  if (light.kind === 'directional')
    return writeSunFace(matrices, matBase, cull, cullBase, light, face, view, side);
  const point = light.kind === 'point';
  const forward = point ? POINT_FACE_AXES[face] : lightDirection(light);
  const fov = point ? Math.PI / 2 : spotFov(light.coneAngle!);
  const planes = shadowProjection(fov, light.range!);
  composeFace(matrices, matBase, light.position!, forward);
  if (cull) {
    const length = Math.hypot(forward[0], forward[1], forward[2]) || 1;
    cull[cullBase] = light.position![0];
    cull[cullBase + 1] = light.position![1];
    cull[cullBase + 2] = light.position![2];
    // Le plan lointain de la face, pas la portée : les deux ne coïncident que si la portée dépasse
    // le plan proche, et un cluster entre les deux doit rester dessiné.
    cull[cullBase + 3] = planes.far;
    cull[cullBase + 4] = forward[0] / length;
    cull[cullBase + 5] = forward[1] / length;
    cull[cullBase + 6] = forward[2] / length;
    // Un demi-champ au-delà du quart de tour couvre déjà tout l'espace : le cône n'exclut plus rien.
    cull[cullBase + 7] =
      planes.halfFov >= Math.PI / 2 ? Math.PI : Math.atan(Math.SQRT2 * Math.tan(planes.halfFov));
  }
  return planes;
}
