import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { VECTOR_CODEC_WGSL, VECTOR_FORMAT } from './velocityWgsl.ts'

/**
 * THE WRITE POINT OF A VOLUME'S VELOCITY: what a pass that draws volumes over the lit image needs to
 * put the velocity of the point it shows into the vectors the temporal pass reads, and nothing for
 * the pass that does not (`velocityTargetOf` answers none, the caller binds nothing and runs no pass).
 *
 * The vectors are the velocity stage's (`velocity.ts`), written once an image before the lighting
 * (`encodeVelocity`). The temporal pass reduces them — the nearest surface's, the dilation, the hole
 * fill — in its own analysis (`analysis.ts`), after every pass that draws over the lit image, so a
 * texel written here before it (`encodeImageChain`) is what the reduction finds: nothing is
 * written twice.
 */

/** What a pass that writes a volume's velocity binds: the vectors it writes (a `VECTOR_FORMAT`
 *  storage texture, one word pair a texel, `size` texels allocated: a write is bounded by the
 *  render grid of the view, `render` of its struct, as the stage's own), and the uniform of the stage's
 *  view (`taaView`, `TAA_VIEW_BYTES` long, the struct `TAA_VIEW_WGSL` of `bindingsWgsl.ts`): the current
 *  image's reprojection — `prevViewProj` and `prevInvViewProj`, the last image's, `invViewProj`, the
 *  current one's inverse, all without the jitter and anchored at this image's eye, so a point
 *  is given relative to the eye (`viewport`, `render`, the grids) — as the stage measured with. */
export interface VolumeVelocityTarget {
  readonly view: GPUTextureView
  readonly format: typeof VECTOR_FORMAT
  readonly size: readonly number[]
  readonly taaView: GPUBuffer
}

/**
 * The target a volume writes its velocity to, or none while the image's vectors are not produced
 * (no pass reads them, or the stage has not drawn them yet): the condition under which the
 * reference binds its velocity at all.
 */
export function velocityTargetOf(rt: WebgpuPagesRuntime): VolumeVelocityTarget | undefined {
  const velocity = rt.gpu.velocity
  // A released target is none (`release` zeroes the size): the vectors are not there to write.
  if (!velocity?.active || !velocity.measured || !velocity.size[0]) return undefined
  return {
    view: velocity.vectors,
    format: VECTOR_FORMAT,
    size: velocity.size,
    taaView: velocity.uniform,
  }
}

/**
 * `volumeVelocityWord(v, step)`: the word pair a volume's texel holds, which replaces the texel whole
 * (a store, never a merge, as the reference's: it writes the volume point's velocity with no
 * animation nor responsiveness flag). `v` is the displacement the camera alone gives a fixed point
 * of the volume — its device position now less the one it had in the last image — and `step` its
 * device depth now less the one it had, held within a half float; the vector is marked as the
 * texel's own, as a vector written by a pass is found by those that read it, and the flags word
 * holds the depth step alone.
 */
export const VOLUME_VELOCITY_WGSL = wgslBlock(
  'VOLUME_VELOCITY_WGSL',
  [VECTOR_CODEC_WGSL],
  `
fn volumeVelocityWord(v:vec2f,step:f32)->vec2u{return vec2u(encodeOwnVector(v,true),withDepthStep(0u,clamp(step,-65504.0,65504.0)));}`,
)
