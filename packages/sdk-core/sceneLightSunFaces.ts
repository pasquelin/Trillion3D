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
 * View-projection matrix of a sun cascade, and the volume the reject opposes to region
 * `rect`: the eye pulled back toward it by the whole box depth, then the orthography of side
 * `2·radius`. The cascade is computed only once for both writes. The published result
 * carries neither aperture nor near plane: the shader reads the cascade scale in the matrix
 * itself, the only source that cannot diverge from it.
 *
 * The volume is the sphere that circumscribes the sub-box the region cuts in the cascade
 * box — the whole box when the region is the whole face. The half-angle is π, so
 * reject only does the distance test: an orthography has no apex, and a cone starting
 * from a point would make no sense for it.
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
