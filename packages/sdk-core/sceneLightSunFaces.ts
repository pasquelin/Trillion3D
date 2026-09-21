import {
  LIGHT_SETTINGS,
  lightDirection,
  type SceneLight,
  type ShadowViewpoint,
} from './sceneLightContracts.ts';
import { composeFace, shadowOrthographic } from './sceneLightShadowMath.ts';
import { writeBoxVolume } from './sceneLightShadowVolume.ts';
import { sunCascadeOf } from './sceneLightSunCascades.ts';

const eye: [number, number, number] = [0, 0, 0];
const boxCenter: [number, number, number] = [0, 0, 0];

/**
 * Depth of a cascade extent, in radii. The sphere sits within one radius of the anchor, on
 * either side; what lies up to `sunCascadeDepthScale` radii between it and the sun must enter
 * the map to cast its shadow there. The eye is therefore pulled back by `depthScale + 2` radii
 * from the anchor, and the far plane stands two radii past it.
 */
const EYE_RADII = LIGHT_SETTINGS.sunCascadeDepthScale + 2;
const DEPTH_RADII = LIGHT_SETTINGS.sunCascadeDepthScale + 4;

/**
 * View-projection matrix of a sun cascade extent, and the volume the reject opposes to region
 * `rect`: the eye pulled back toward the sun from the extent anchor, then the orthography of
 * side `2·radius`. The cascade is computed only once for both writes. The published result
 * carries neither aperture nor near plane: the shader reads the cascade scale in the matrix
 * itself, the only source that cannot diverge from it.
 *
 * The volume is the box the region cuts in the extent: its rectangle on the light plane,
 * the whole extent depth along the axis. A strip of pages that enters the extent under a
 * camera step thus rejects everything outside its own column of world — the depth bounds
 * of the map, not a sphere around the whole cascade.
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
  const radius = cascade.radius,
    far = DEPTH_RADII * radius;
  for (let a = 0; a < 3; a++) {
    eye[a] = cascade.center[a] - axis[a] * EYE_RADII * radius;
    boxCenter[a] = eye[a] + axis[a] * (far / 2);
  }
  // The orthography spans the extent, one page wider than the sphere (`sunCascadeOf`).
  const planes = shadowOrthographic(cascade.halfSide, far);
  composeFace(matrices, matBase, eye, axis);
  if (cull) writeBoxVolume(cull, cullBase, boxCenter, cascade.halfSide, far / 2, rect);
  return planes;
}
