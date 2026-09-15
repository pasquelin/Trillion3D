import {
  LIGHT_SETTINGS,
  lightDirection,
  type SceneLight,
  type ShadowViewpoint,
} from './sceneLightContracts.ts';
import { composeFace, shadowOrthographic } from './sceneLightShadowMath.ts';
import { writeSphereVolume } from './sceneLightShadowVolume.ts';
import { sunCascadeOf } from './sceneLightSunCascades.ts';

const eye: [number, number, number] = [0, 0, 0];

/**
 * La matrice vue-projection d'une cascade du soleil, et le volume que le rejet oppose à la région
 * `rect` : l'œil reculé vers lui de toute la profondeur de la boîte, puis l'orthographie de côté
 * `2·rayon`. La cascade n'est calculée qu'une fois pour les deux écritures. Le résultat publié ne
 * porte ni ouverture ni plan proche : le shader lit l'échelle de la cascade dans la matrice
 * elle-même, la seule source qui ne puisse pas diverger d'elle.
 *
 * Le volume est la sphère qui circonscrit la sous-boîte que la région découpe dans la boîte de la
 * cascade — la boîte entière quand la région est la face entière. Le demi-angle vaut π, donc le
 * rejet ne fait que le test de distance : une orthographie n'a pas de sommet, et un cône partant
 * d'un point n'aurait aucun sens pour elle.
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
  rect: Float64Array,
) {
  const axis = lightDirection(light);
  const cascade = sunCascadeOf(view, axis, face, side);
  const depth = cascade.radius * LIGHT_SETTINGS.sunCascadeDepthScale;
  for (let a = 0; a < 3; a++) eye[a] = cascade.center[a] - axis[a] * depth;
  const planes = shadowOrthographic(cascade.radius, depth + cascade.radius);
  composeFace(matrices, matBase, eye, axis);
  if (cull)
    writeSphereVolume(
      cull,
      cullBase,
      cascade.boxCenter,
      cascade.radius,
      (cascade.radius * (LIGHT_SETTINGS.sunCascadeDepthScale + 1)) / 2,
      rect,
    );
  return planes;
}
