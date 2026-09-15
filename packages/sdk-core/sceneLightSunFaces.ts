import { LIGHT_SETTINGS, type SceneLight } from './sceneLightContracts.ts';
import { composeFace, projScratch, shadowOrthographic } from './sceneLightShadowMath.ts';
import { sunAxisOf, sunCascadeOf, type ShadowViewpoint } from './sceneLightSunCascades.ts';

const eye: [number, number, number] = [0, 0, 0];

/**
 * La matrice vue-projection d'une cascade du soleil : l'œil reculé vers lui de toute la profondeur
 * de la boîte, puis l'orthographie de côté `2·rayon`. Le résultat publié ne porte ni ouverture ni
 * plan proche : le shader lit l'échelle de la cascade dans la matrice elle-même, la seule source
 * qui ne puisse pas diverger d'elle.
 */
export function writeSunMatrix(
  out: Float32Array,
  base: number,
  light: SceneLight,
  face: number,
  view: ShadowViewpoint,
  side: number,
) {
  const axis = sunAxisOf(light);
  const cascade = sunCascadeOf(view, axis, face, side);
  const depth = cascade.radius * LIGHT_SETTINGS.sunCascadeDepthScale;
  for (let a = 0; a < 3; a++) eye[a] = cascade.center[a] - axis[a] * depth;
  const far = depth + cascade.radius;
  shadowOrthographic(projScratch, 0, cascade.radius, far);
  composeFace(out, base, eye, axis);
  return { near: 0, far, halfFov: 0 };
}

/**
 * Le volume d'une cascade, sous forme de sphère : celle qui circonscrit la boîte de sa projection.
 * Le demi-angle vaut π, donc le rejet ne fait que le test de distance — une orthographie n'a pas de
 * sommet, et un cône partant d'un point n'aurait aucun sens pour elle. Le rejet reste conservateur :
 * un cluster gardé à tort est de toute façon découpé par les plans latéraux de la projection.
 */
export function writeSunCull(
  out: Float32Array,
  base: number,
  light: SceneLight,
  face: number,
  view: ShadowViewpoint,
  side: number,
) {
  const cascade = sunCascadeOf(view, sunAxisOf(light), face, side);
  out[base] = cascade.boxCenter[0];
  out[base + 1] = cascade.boxCenter[1];
  out[base + 2] = cascade.boxCenter[2];
  out[base + 3] = cascade.boxRadius;
  out[base + 4] = 0;
  out[base + 5] = 1;
  out[base + 6] = 0;
  out[base + 7] = Math.PI;
}
