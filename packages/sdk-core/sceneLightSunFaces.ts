import {
  LIGHT_SETTINGS,
  lightDirection,
  type SceneLight,
  type ShadowViewpoint,
} from './sceneLightContracts.ts';
import { composeFace, shadowOrthographic } from './sceneLightShadowMath.ts';
import { sunCascadeOf } from './sceneLightSunCascades.ts';

const eye: [number, number, number] = [0, 0, 0];

/**
 * La matrice vue-projection d'une cascade du soleil, et le volume que le rejet lui oppose : l'œil
 * reculé vers lui de toute la profondeur de la boîte, puis l'orthographie de côté `2·rayon`. La
 * cascade n'est calculée qu'une fois pour les deux écritures. Le résultat publié ne porte ni
 * ouverture ni plan proche : le shader lit l'échelle de la cascade dans la matrice elle-même, la
 * seule source qui ne puisse pas diverger d'elle.
 *
 * Le volume est la sphère qui circonscrit la boîte de la projection. Le demi-angle vaut π, donc le
 * rejet ne fait que le test de distance — une orthographie n'a pas de sommet, et un cône partant
 * d'un point n'aurait aucun sens pour elle. Le rejet reste conservateur : un cluster gardé à tort est
 * de toute façon découpé par les plans latéraux de la projection.
 */
export function writeSunFace(
  matrices: Float32Array,
  matBase: number,
  cull: Float32Array | null,
  cullBase: number,
  light: SceneLight,
  face: number,
  view: ShadowViewpoint,
  side: number,
) {
  const axis = lightDirection(light);
  const cascade = sunCascadeOf(view, axis, face, side);
  const depth = cascade.radius * LIGHT_SETTINGS.sunCascadeDepthScale;
  for (let a = 0; a < 3; a++) eye[a] = cascade.center[a] - axis[a] * depth;
  const planes = shadowOrthographic(cascade.radius, depth + cascade.radius);
  composeFace(matrices, matBase, eye, axis);
  if (cull) {
    cull[cullBase] = cascade.boxCenter[0];
    cull[cullBase + 1] = cascade.boxCenter[1];
    cull[cullBase + 2] = cascade.boxCenter[2];
    cull[cullBase + 3] = cascade.boxRadius;
    cull[cullBase + 4] = 0;
    cull[cullBase + 5] = 1;
    cull[cullBase + 6] = 0;
    cull[cullBase + 7] = Math.PI;
  }
  return planes;
}
