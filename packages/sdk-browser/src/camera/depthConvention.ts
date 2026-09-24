/**
 * THE ENGINE DEPTH CONVENTION: ONE ONLY, REVERSED, INFINITE FAR PLANE.
 *
 * THE FACT. The engine's normalized depth goes from 1 at the near plane to 0 at infinity, and
 * it no longer depends on the host camera: `readCameraWorld` no longer copies the host
 * projection matrix, it composes one with `perspectiveProjection` (sdk-core/mathCamera.ts),
 * whose depth row contains no far plane — `ndc = near / distance`. There are therefore no
 * longer two conventions to reconcile: there is one, and this file is its home.
 *
 * WHY. A single-precision depth carries its bits near zero and the perspective divide
 * carries them near the near plane; putting them head to tail spreads them. Two points a
 * metre apart at a million units then keep distinct depths, where the forward convention
 * crushed them onto the same value.
 *
 * WHAT THIS FILE DECIDES, and that no one else redecides:
 *  - depth comparison of the pipelines (`DEPTH_COMPARE`) and of the shadow atlases;
 *  - the clear value of a depth target (`DEPTH_CLEAR`), which is the far;
 *  - the sense of extrema: what "nearer" is (`depthNearer`), hence the sense of Hi-Z
 *    reduction, which keeps the FARTHEST of a square, hence the MINIMUM;
 *  - conversion of a normalized depth to eye distance (`depthDistance`) and the inverse.
 *
 * WHAT DOES NOT CHANGE. Normalized x and y are `[−1, 1]` and their passage to the screen
 * depends on nothing here. The host WebGL2 path, for its part, draws with the host-library
 * projection, in FORWARD depth: it signs the coplanar-layer offset itself
 * (`bench/witnesses/exact/batches/batchLayers.ts`); it reads from this file only the depth
 * material's ramp (`writeDepthRamp`), which is the same on both paths.
 */

/** Depth comparison of every pipeline: in reversed depth, the greater wins. */
export const DEPTH_COMPARE: GPUCompareFunction = 'greater';
/** The same comparison, equality included: what a resolve redraws on its own depth. */
export const DEPTH_COMPARE_OR_EQUAL: GPUCompareFunction = 'greater-equal';

/** Near-plane depth. Nothing can be nearer. */
export const DEPTH_NEAR = 1;

/**
 * Far depth, hence the clear value of a depth target and the background of software
 * depth buffers. With the infinite far plane, no surface reaches it.
 */
export const DEPTH_CLEAR = 0;

/** Is `a` strictly nearer the eye than `b`? The only place that says so. */
export function depthNearer(a: number, b: number) {
  return a > b;
}

/**
 * Eye distance of a normalized depth, `near` being the projection's near plane:
 * `ndc = near / distance`, hence `distance = near / ndc`. A zero depth — the far — yields
 * infinity, which is what it describes. The formula is its own inverse: the same function
 * yields the normalized depth of a point at `distance` from the eye.
 */
export function depthDistance(depth: number, near: number) {
  return near / depth;
}

/**
 * A view-projection and nothing else: what a depth reader needs to know of a camera. An
 * `EngineCamera` is one. The type survives the disappearance of the two conventions because
 * an oracle can mount a view-projection without mounting a whole camera; it is an owned
 * buffer, as everywhere the core multiplies matrices (`packages/sdk-core/src/math/matrix/matrix4.ts`).
 */
export type DepthCamera = { viewProjection: Float64Array };

/**
 * The grey ramp a depth material shows, in one convention whatever the depth buffer holds:
 * white at `near`, black at `far`, linear in view distance `d` — `(far − d) / (far − near)`.
 * Written as three weights `(a, b, c)` a shader applies to a pixel's clip coordinates,
 * `ramp = a·w + b + c·z/w`: under a perspective projection `w` is `d` (`c = 0`); under the
 * orthographic one, whose reversed depth is already affine from 1 at `near` to 0 at `far`,
 * `z/w` is the ramp itself (`a = b = 0`, `c = 1`). A renderer that holds the view distance
 * itself applies `a·d + b` alone, the perspective weights.
 */
export function writeDepthRamp(
  out: Float32Array,
  offset: number,
  near: number,
  far: number,
  perspective: number,
) {
  const span = far - near;
  out[offset] = -perspective / span;
  out[offset + 1] = (perspective * far) / span;
  out[offset + 2] = 1 - perspective;
  return out;
}
