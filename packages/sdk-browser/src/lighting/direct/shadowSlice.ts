import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'

/**
 * A shadowed light's `params.y` (its shadow slice, −1 without a shadow): the rank of its record in the
 * frame's projection (`VsmProjectionView.lights`) and two flags. A sun's record rank is also the layer of
 * the suns' mask it is read from (a sun's shadow is a texture a sun); a local light is read from the
 * mask of its pixel, the lane of the shadowed local lights in the order its cell lists them, the
 * `distant` ones (a map of one page) last (`vsmMaskLaneOf`).
 */
const SHADOW_SLICE_DISTANT = 1
const SHADOW_SLICE_SUN = 2
const SHADOW_SLICE_RECORD_SHIFT = 2

/** The slice of the light of record `record`. */
export const shadowSliceOf = (record: number, sun: boolean, distant: boolean) =>
  record * (1 << SHADOW_SLICE_RECORD_SHIFT) +
  (sun ? SHADOW_SLICE_SUN : 0) +
  (distant ? SHADOW_SLICE_DISTANT : 0)

/** The slice, read in WGSL: the light's record, whether it is a sun, whether its map is a single page. */
export const SHADOW_SLICE_WGSL = wgslBlock(
  'SHADOW_SLICE_WGSL',
  [],
  `
fn shadowSliceRecord(slice:i32)->u32{return u32(slice)>>${SHADOW_SLICE_RECORD_SHIFT}u;}
fn shadowSliceIsSun(slice:i32)->bool{return (u32(slice)&${SHADOW_SLICE_SUN}u)!=0u;}
fn shadowSliceDistant(slice:i32)->bool{return (u32(slice)&${SHADOW_SLICE_DISTANT}u)!=0u;}`,
)
