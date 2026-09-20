import { copyMatrix4, multiplyMatrix4 } from './mathMatrix4.ts';
import { crossVector3, dotVector3 } from './mathVector.ts';
import { LIGHT_SETTINGS } from './sceneLightContracts.ts';

/**
 * COMPOSITION BUFFERS OF A FACE, in double precision and rounded BY HAND.
 *
 * A shadow map is read by the GPU in single precision: projection and view were therefore
 * written into `Float32Array`s, and each term rounded on the way. The kernel product
 * now accepts only one buffer type (`mathMatrix4.ts`) — a single `Float32Array` caller
 * made polymorphic the forty-eight accesses that every hot loop of the engine shares.
 * The three buffers are therefore `Float64Array`s, and `arrondi` puts single-precision rounding back
 * where storage used to do it: the product reads exactly the same numbers as before, its terms are
 * computed in double as before, and the final copy into the GPU buffer rounds them once,
 * where a `Float32Array` to `Float32Array` copy changed nothing. Same bits, then.
 */
const arrondi = Math.fround;
const projScratch = new Float64Array(16);
/** Planes of a face and half-field of its projection. Only one is live at a time: the caller reads it
 *  before composing the next face, so the object is reused and nothing is allocated per frame. */
const planes = { near: 0, far: 0, halfFov: 0 };

/**
 * Perspective projection of a shadow face, REVERSED depth in `[0, 1]` like that of the
 * camera (`depthConvention.ts`): the near plane projects onto 1, the far onto 0, and the atlas
 * compares as `greater`. `near` is derived from range alone: one source for
 * projection and for reject, otherwise the two could diverge by a hair at the edge, and never a
 * hidden setting.
 *
 * An emitter envelope radius does not touch this plane: raising a face's near plane
 * removes a cube, up to √3 times its value on the diagonals, not the announced sphere. The
 * radius is therefore applied where shadow depth is written, by distance to the light centre
 * (`gpuShadowShader.ts`), and this near plane remains the one range gives every light.
 */
export function shadowProjection(fov: number, range: number) {
  const near = Math.max(LIGHT_SETTINGS.shadowNearMin, range * LIGHT_SETTINGS.shadowNearFraction),
    far = Math.max(near * 1.001, range);
  const f = 1 / Math.tan(fov / 2),
    depth = near / (far - near);
  projScratch.fill(0);
  projScratch[0] = arrondi(f);
  projScratch[5] = arrondi(f);
  projScratch[10] = arrondi(depth);
  projScratch[11] = -1;
  projScratch[14] = arrondi(far * depth);
  planes.near = near;
  planes.far = far;
  planes.halfFov = fov / 2;
  return planes;
}

/**
 * Orthographic projection of a cascade, REVERSED depth in `[0, 1]`, column-major: the eye
 * projects onto 1 and the far plane onto 0. The near plane is at the eye: it is already pulled
 * back toward the light by the whole wanted depth. An orthography has neither a near plane nor an
 * aperture to publish: both come out zero.
 */
export function shadowOrthographic(halfExtent: number, far: number) {
  projScratch.fill(0);
  projScratch[0] = arrondi(1 / halfExtent);
  projScratch[5] = arrondi(1 / halfExtent);
  projScratch[10] = arrondi(1 / far);
  projScratch[14] = 1;
  projScratch[15] = 1;
  planes.near = 0;
  planes.far = far;
  planes.halfFov = 0;
  return planes;
}

/**
 * World frame of the last composed face: right, up, forward. This is what lets a
 * map rectangle — a region of pages — be carried into the world without recomputing the frame elsewhere,
 * hence without a second copy being able to diverge from this one.
 */
export const faceBasis = new Float64Array(9);

/** Up-frame axes: `y` in general, `z` when the direction is almost parallel to it. */
const UP_Y = [0, 1, 0] as const,
  UP_Z = [0, 0, 1] as const;
const right = new Float64Array(3),
  upward = new Float64Array(3);

/**
 * Right and up axes of a face looking along `forward`: the frame its view matrix is composed
 * with. A sun cascade aligns its page grid on these same two axes, so the map slides by whole
 * pages under the camera — one calculation for the view and for the grid, nothing can diverge.
 */
export function faceFrame(
  forward: readonly [number, number, number] | ArrayLike<number>,
  outRight: Float64Array,
  outUp: Float64Array,
) {
  // A frame axis parallel to the direction would make a zero cross product: the up axis is switched.
  crossVector3(outRight, forward, Math.abs(forward[1]) > 0.999 ? UP_Z : UP_Y);
  const rl = Math.hypot(outRight[0], outRight[1], outRight[2]) || 1;
  outRight[0] /= rl;
  outRight[1] /= rl;
  outRight[2] /= rl;
  crossVector3(outUp, outRight, forward);
}

/** Column-major view matrix of a camera at `eye` looking along `forward`. */
function shadowView(
  out: Float64Array,
  eye: readonly [number, number, number],
  forward: readonly [number, number, number],
) {
  const fx = forward[0],
    fy = forward[1],
    fz = forward[2];
  faceFrame(forward, right, upward);
  for (let axis = 0; axis < 3; axis++) {
    faceBasis[axis] = right[axis];
    faceBasis[3 + axis] = upward[axis];
    faceBasis[6 + axis] = forward[axis];
  }
  out[0] = arrondi(right[0]);
  out[1] = arrondi(upward[0]);
  out[2] = arrondi(-fx);
  out[3] = 0;
  out[4] = arrondi(right[1]);
  out[5] = arrondi(upward[1]);
  out[6] = arrondi(-fy);
  out[7] = 0;
  out[8] = arrondi(right[2]);
  out[9] = arrondi(upward[2]);
  out[10] = arrondi(-fz);
  out[11] = 0;
  out[12] = arrondi(-dotVector3(right, eye));
  out[13] = arrondi(-dotVector3(upward, eye));
  out[14] = arrondi(dotVector3(forward, eye));
  out[15] = 1;
}

const viewScratch = new Float64Array(16),
  faceScratch = new Float64Array(16);

/**
 * View then projection, composed into `out`: the only path by which a face gets its matrix.
 * The projection is the one `shadowProjection` or `shadowOrthographic` has just written.
 */
export function composeFace(
  out: Float32Array,
  base: number,
  eye: readonly [number, number, number],
  forward: readonly [number, number, number],
) {
  shadowView(viewScratch, eye, forward);
  // Composed aside then copied: `multiplyMatrix4` only writes the sixteen constant indices, and the
  // copy into the GPU buffer is the only single-precision conversion. One face per light and
  // per frame; the offset was not worth sixteen computed indices in the hottest product.
  multiplyMatrix4(faceScratch, projScratch, viewScratch);
  copyMatrix4(out, faceScratch, base);
}
