import {
  LIGHT_KIND,
  LIGHT_SETTINGS,
  POINT_FACES,
  lightDirection,
  type SceneLight,
  type ShadowViewpoint,
} from '../light/contracts.ts';
import { composeFace, shadowProjection } from './math.ts';
import { FULL_FACE, writeConeVolume } from './volume.ts';
import { writeSunFace } from './sunFaces.ts';

/**
 * The six axes of a point light, in the order the shader recovers from the major axis of the
 * light → point direction: +X, −X, +Y, −Y, +Z, −Z. The order is the contract, not a detail.
 */
export const POINT_FACE_AXES: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];
/**
 * Floats of a face in the slice buffer: the matrix, the atlas rectangle — its fourth float 1
 * once drawn, 0 never —, then four words: the held-page mask, one bit per physical page that
 * holds a depth of the current extent, rows of eight in two words, and the physical page of
 * the extent origin, `x` then `y`, the read wraps extent coordinates with. An extent page
 * that entered but is not yet drawn still holds what the far side left there: the read must
 * know it and fall back to the next cascade, never sample it. A page merely awaiting a redraw
 * is still held, and read.
 */
export const SHADOW_FACE_FLOATS = 24;
/** Word of a light's shadow faces in its GPU record. */
export const SHADOW_FACE_MASK_WORD = 20;
/** Floats of a slice: six faces plus a header `vec4f` (faces, kind, side, pad). */
export const SHADOW_SLICE_FLOATS = POINT_FACES * SHADOW_FACE_FLOATS + 4;

/**
 * Faces actually drawn for a light: six for a point, one for a spot, and
 * the cascades for a directional — never more than the six faces reserved per slice.
 */
export function faceCountOf(rank: number) {
  if (rank === LIGHT_KIND.point) return POINT_FACES;
  if (rank === LIGHT_KIND.directional) return Math.min(POINT_FACES, LIGHT_SETTINGS.sunCascades);
  return 1;
}

/** Half-angle of the cone widened by half a degree, so the cone edge stays covered by the map. */
const spotFov = (coneAngle: number) => Math.min(Math.PI * 0.98, 2 * coneAngle + 0.0175);

/**
 * Floats of a region volume: centre and far plane, face axis and half-angle, then — for a
 * box, flagged by a negative half-angle — the two other axes with their half-extents.
 */
export const SHADOW_CULL_FLOATS = 16;

/**
 * Writes the view-projection matrix of a face at its slot in `matrices`, and, if reject is
 * armed, the volume it opposes to region `rect` of that face. Both start from the same axis
 * and the same field — one calculation, so no risk they aim at different directions. A
 * point takes the `POINT_FACE_AXES` axis and 90°; a spot takes its direction and its widened
 * cone; a directional takes cascade `face`, which follows the camera. The emitter radius, for
 * its part, touches neither projection nor reject: its exclusion is exactly a sphere, written where
 * shadow depth is written, and a raised near plane would remove a cube from it.
 *
 * `rect` is the part of the face to redraw, in normalised coordinates; `FULL_FACE` by default,
 * and the volume is then exactly that from before per-page invalidation. A cluster whose
 * world sphere touches neither the range nor this volume can write nothing in the region: the
 * projection and the scissor would reject it anyway. Reject is therefore exact, never a
 * quality approximation — the region does not change by a texel.
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
  rect: Float64Array = FULL_FACE,
) {
  if (light.kind === 'directional')
    return writeSunFace(matrices, matBase, cull, cullBase, light, face, view, side, rect);
  const point = light.kind === 'point';
  const forward = point ? POINT_FACE_AXES[face] : lightDirection(light);
  const fov = point ? Math.PI / 2 : spotFov(light.coneAngle!);
  const planes = shadowProjection(fov, light.range!);
  composeFace(matrices, matBase, light.position!, forward);
  // The far plane of the face, not the range: the two coincide only if the range exceeds the
  // near plane, and a cluster between the two must stay drawn.
  if (cull) writeConeVolume(cull, cullBase, light.position!, planes.far, planes.halfFov, rect);
  return planes;
}
