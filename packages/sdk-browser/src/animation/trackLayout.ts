/**
 * The layout of the packed tracks the animation sampler reads (`batchAnimation.ts` packs them,
 * `packages/page-codec-wasm/src/anim.rs` samples them): words a track, numbers of an arc, kind
 * bits. Printed into the sampler's Rust (`scripts/shared-rules/abi.ts`, `anim_layout.rs`).
 */

/** Words describing one track. */
export const TRACK_WORDS = 6
/** Numbers of one track's arc: the key it starts at (−1: none yet), its side, angle and sine. */
export const ARC_VALUES = 4
/** Kind bit: the track holds rotations. */
export const QUATERNION = 1
/** Interpolation, in the kind's bits above the first: the earlier key. */
export const STEP = 2
/** Interpolation, in the kind's bits above the first: glTF's spline. */
export const CUBIC = 4
