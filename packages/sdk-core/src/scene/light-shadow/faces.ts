import { lightDirection, type SceneLight } from '../light/contracts.ts';
import { composeFace, shadowProjection } from './math.ts';
import { FULL_FACE, regionRect, writeConeVolume } from './volume.ts';
import { lampPagesAt } from './virtual.ts';

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
 * Floats of a shadow record, the one a light's shading reads: six lamp-face matrices, then the
 * sun's light-plane frame — `right, zNear`, `up, zFar`, `axis, 0` —, then the extent origin of
 * each clipmap slot as two integers, then a header `vec4f`: faces (a lamp) or levels (a sun),
 * the lamp's tangent half-field or the sun's finest level, the lamp's near plane, and the
 * record's first page-table entry.
 */
export const SHADOW_RECORD_FLOATS = 6 * 16 + 12 + 32 + 4;
export const SHADOW_RECORD_FRAME = 96;
export const SHADOW_RECORD_ORIGINS = 108;
export const SHADOW_RECORD_INFO = 140;

/** Half-angle of the cone widened by half a degree, so the cone edge stays covered by the map. */
const spotFov = (coneAngle: number) => Math.min(Math.PI * 0.98, 2 * coneAngle + 0.0175);

/**
 * Floats of a cull volume: centre and far plane, face axis and half-angle, then — for a
 * box, flagged by a negative half-angle — the two other axes with their half-extents, then the
 * word that says which casters the region draws, the light-cut view that selected them, and two
 * of padding.
 */
export const SHADOW_CULL_FLOATS = 20;
/** Float of a cull volume that carries which casters its region draws. */
export const SHADOW_CULL_CASTERS = 16;
/** Float of a cull volume that carries the view of the frame's light cut its region reads. */
export const SHADOW_CULL_VIEW = 17;

/**
 * Writes the view-projection matrix of a lamp face at its slot in `matrices`, and, if the cull
 * is armed, the volume it opposes to rectangle `rect` of that face. Both start from the same
 * axis and the same field — one calculation, so no risk they aim at different directions. A
 * point takes the `POINT_FACE_AXES` axis and 90°; a spot takes its direction and its widened
 * cone. The emitter radius touches neither projection nor cull: its exclusion is exactly a
 * sphere, written where shadow depth is written.
 *
 * `rect` is the part of the face to draw, in normalised coordinates; `FULL_FACE` by default.
 * A cluster whose world sphere touches neither the range nor this volume can write nothing in
 * it: the projection and the viewport would reject it anyway, so the cull is exact.
 */
export function writeFace(
  matrices: Float32Array,
  matBase: number,
  cull: Float32Array | null,
  cullBase: number,
  light: SceneLight,
  face: number,
  rect: Float64Array = FULL_FACE,
) {
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

const pageRect = new Float64Array(4);

/**
 * View-projection of lamp page `(x, y)` of `face` at `mip`, and its cull volume: the face's
 * matrix cropped, in clip space, so that the page fills the clip square — the physical page
 * the draw's viewport names. `x' = a·x + b·w`: the crop commutes with the perspective divide,
 * so a texel lands where the shading, reading the whole face, looks for it.
 */
export function writeLampPage(
  matrices: Float32Array,
  matBase: number,
  cull: Float32Array | null,
  cullBase: number,
  light: SceneLight,
  face: number,
  mip: number,
  x: number,
  y: number,
) {
  regionRect(pageRect, lampPagesAt(mip), x, x, y, y);
  const planes = writeFace(matrices, matBase, cull, cullBase, light, face, pageRect);
  const a = 2 / (pageRect[1] - pageRect[0]),
    b = -(pageRect[0] + pageRect[1]) / (pageRect[1] - pageRect[0]),
    c = 2 / (pageRect[3] - pageRect[2]),
    d = -(pageRect[2] + pageRect[3]) / (pageRect[3] - pageRect[2]);
  for (let column = 0; column < 4; column++) {
    const at = matBase + column * 4,
      w = matrices[at + 3];
    matrices[at] = a * matrices[at] + b * w;
    matrices[at + 1] = c * matrices[at + 1] + d * w;
  }
  return planes;
}
