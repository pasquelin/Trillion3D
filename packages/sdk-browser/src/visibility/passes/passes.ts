import { skipsSecondaryPass } from '../../diagnostic/gpuGeometry.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import type { VisibilityRasterStages } from '../../frame/render/encodeVisSetup.ts'
import { HIZ_PASS } from '../../diagnostic/stage/passLabels.ts'
import { LazyComputePass } from '../../gpu/core/lazyComputePass.ts'
import { prepared } from '../../frame/backend/state/prepared.ts'
import { cutPyramid, notePyramidBuilt } from '../../frame/render/cutPyramid.ts'
import { cutOf } from '../../frame/render/gpuCutStream.ts'

/** The occlusion step's compute pass, opened by the first of its kernels that dispatches. */
const hizPass = new LazyComputePass(HIZ_PASS)

/** The pyramid's culling layer built from the depth in level 0, in a compute pass of its own. */
function encodePyramid(rt: WebgpuPagesRuntime, encoder: GPUCommandEncoder) {
  prepared(rt.vis, 'gpuHiz').encodePyramid(hizPass.begin(encoder))
  hizPass.end()
  rt.run.hizPyramidFresh = true
}

/**
 * The visibility buffer, in the order of the cut's two-pass occlusion: the main pass's clusters —
 * hardware slots, then software lists — and the pyramid's level zero from them
 * (`raster.occluders`); the pyramid built from that depth; the cut's post pass, which judges against
 * it what the previous image's pyramid hid (`GpuSelection.encodePost`); the post pass's clusters
 * (`raster.rest`) and the pyramid built again from the whole depth, which the next image's main
 * pass reads; then the identifiers of everything drawn and the resolve into the attachments
 * (`../../frame/render/encodeVisSetup.ts`). A cut in one pass — a view's first image, the
 * occlusion turned off — draws everything in the first: the pyramid is built once, from the whole
 * depth. Both rasters write the one buffer by the one rule (`VIS_WRITE_WGSL`).
 */
export function encodeWebgpuVisibilityPasses(
  rt: WebgpuPagesRuntime,
  encoder: GPUCommandEncoder,
  raster: VisibilityRasterStages,
) {
  const { run } = rt
  raster.occluders(encoder)
  rt.run.hizPyramidFresh = false
  encodePyramid(rt, encoder)
  // The drawn view's cut, the main one or its own aside (`../../geometry/dag/aside.ts`).
  const post = !!cutOf(rt)?.encodePost(encoder, cutPyramid(rt))
  // The only diagnostic variant that touches encoded commands: it leaves the post pass's clusters
  // out of the image to weigh the main pass's alone, and therefore yields an incomplete image.
  const withRest = post && !skipsSecondaryPass(rt.context?.diagnosticGpuVariant)
  if (withRest) {
    raster.rest(encoder)
    encodePyramid(rt, encoder)
  }
  // The pyramid holds the image's whole depth — but where the post pass's clusters were left out —:
  // what the view's next main pass tests against.
  notePyramidBuilt(rt, encoder, run.gate.cam, withRest || !post)
  raster.ids(encoder, withRest)
  // Level 0 now holds every opaque pixel's depth: what the pyramid's nearest layer is built from,
  // in the reflections' pass (`../../lighting/reflections/frame.ts`).
  rt.run.depthDrawn = true
}
