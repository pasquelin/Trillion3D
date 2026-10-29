import { fieldLayout } from '../../../gpu/core/fieldLayout.ts'

/**
 * THE PARAMETERS OF ONE DISPATCH OF THE RESERVOIR GATHER, 256 bytes, read at a dynamic offset (`PARAM_SLOT_BYTES`: one slot a dispatch, so that the passes of an
 * image each carry their own — the spatial pass's rank, the sets they read and write):
 *  - `size`: the reservoir view's texels across and down (`xy`), the reduction from the image (`z`), the frame the reservoirs of this image are placed with (`w`, the image number or the fixed jitter);
 *  - `image`: the drawn image's size (`xy`), the frame the last image's reservoirs were placed with (`z`), and whether the last image's reservoirs and lit image are held (`w`);
 *  - `sets`: the set a pass reads (`x`), the set it writes (`y`), the last image's set (`z`) and the set whose surface a cleared history keeps (`w`);
 *  - `exposure`: the pre-exposure of the image (`x`), the ratio of that to the last image's (`y`), the most light a ray brings back (`z`) and the furthest it looks, in metres (`w`);
 *  - `threshold`: the relative depth error (`x`) and the cosine of the angle (`y`) under which two reservoirs are merged, `zw` unused;
 *  - `spatial`: the spatial kernel's radius in texels (`x`), the length of the occlusion screen trace as a fraction of the screen (`y`), the neighbours (`z`) and the pass's rank (`w`);
 *  - `upsample`: the method (`x`, 0 jittered bilinear, 1 spiral, 2 passthrough), the kernel size in texels (`y`), the samples (`z`) and whether the variance is computed (`w`);
 *  - `accumulate`: the frames at most (`x`), the relative depth under which the last image's light is the pixel's (`y`) (`image.w` says whether the last image's reservoirs, or light, are held);
 *  - `bilateral`: the kernel radius as a fraction of the view's width (`x`), the samples (`y`), the depth weight's scale (`z`) and the normal's (`w`); `strong` the variance above which a pixel is blurred twice as wide (`x`);
 *  - `trace`: the sampling depth bias of the cards a hit reads (`x`), the nearest hit that lights anything (`y`), how a ray avoids the geometry it starts on (`z`) and the mode (`w`, 0 the first rays, 1 the last image's reservoirs validated);
 *  - `leak`: the roughness the sky light that leaks is read at (`x`), the inverse of the distance it leaks whole at (`y`);
 *  - `previousInverse`: the inverse of the view-projection the last lit image was drawn with, which turns a texel and a depth of the last image back to the world.
 */
export const RESERVOIR_PARAMS = fieldLayout('ReservoirParams', [
  ['size', 'vec4u'],
  ['image', 'vec4u'],
  ['sets', 'vec4u'],
  ['exposure', 'vec4f'],
  ['threshold', 'vec4f'],
  ['spatial', 'vec4f'],
  ['upsample', 'vec4f'],
  ['accumulate', 'vec4f'],
  ['bilateral', 'vec4f'],
  ['strong', 'vec4f'],
  ['trace', 'vec4f'],
  ['leak', 'vec4f'],
  ['previousInverse', 'mat4x4f'],
] as const)

/** The bytes of a slot, the uniform buffer offset alignment every device grants. */
export const PARAM_SLOT_BYTES = 256

/** The slots of an image: validation, first rays, temporal resampling (or clearing), the spatial passes (at most 16), the upsampling, the accumulation, the bilateral filter. */
export const MAX_SPATIAL_PASSES = 16
export const PARAM_SLOT = {
  validate: 0,
  rays: 1,
  temporal: 2,
  spatial: 3,
  upsample: 3 + MAX_SPATIAL_PASSES,
  accumulate: 4 + MAX_SPATIAL_PASSES,
  bilateral: 5 + MAX_SPATIAL_PASSES,
  count: 6 + MAX_SPATIAL_PASSES,
} as const

/** The sets of reservoirs: the first rays', the spatial passes' other, and the two the last image's history alternates between. */
export const RESERVOIR_SET = { rays: 0, spatial: 1, history: [2, 3] } as const

/** The words a reservoir takes in the pools: four `vec4f`. */
export const RESERVOIR_VECTORS = 4

/** The upsampling methods, in the order `reservoirGatherUpsampleMethod` names them. */
export const UPSAMPLE_METHODS = ['jitteredBilinear', 'spiral', 'passthrough'] as const

/** A parameter block of `PARAM_SLOT.count` slots, as a float and an unsigned view of the same words. */
export function createParamBlock() {
  const bytes = new ArrayBuffer(PARAM_SLOT_BYTES * PARAM_SLOT.count)
  return { floats: new Float32Array(bytes), words: new Uint32Array(bytes), bytes }
}
export type ParamBlock = ReturnType<typeof createParamBlock>

/** The first word of the field `field` in the slot `slot`. */
export const wordOf = (slot: number, field: keyof typeof RESERVOIR_PARAMS.at) =>
  (slot * PARAM_SLOT_BYTES) / 4 + RESERVOIR_PARAMS.at[field]
