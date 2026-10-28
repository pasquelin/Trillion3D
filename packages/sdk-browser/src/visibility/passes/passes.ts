import { skipsSecondaryPass } from '../../diagnostic/gpuGeometry.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import type { VisibilityRasterStages } from '../../frame/render/encodeVisSetup.ts'
import { HIZ_PASS } from '../../diagnostic/stage/passLabels.ts'
import { ComputeRun, LazyComputePass } from '../../gpu/core/lazyComputePass.ts'
import { prepared } from '../../frame/backend/state/prepared.ts'
import { notePyramidBuilt } from '../../frame/render/cutPyramid.ts'
import { cutPyramid } from '../../frame/render/pyramidSources.ts'
import { cutOf } from '../../frame/render/gpuCutStream.ts'
import { twoPassOf } from '../../geometry/dag/shader/occlusionWgsl.ts'
import { readHizSetting } from '../../../../sdk-core/src/contracts/hizOptions.ts'

/** The occlusion step's compute pass, opened by the first of its kernels that dispatches. */
const hizPass = new LazyComputePass(HIZ_PASS)
const visibilitySteps = new ComputeRun()

/**
 * Whether the image's last build of the pyramid also builds its trace layers (`GpuHiz.encodeFull`):
 * the lit image reads them (`reflection`), and the transparents' fold (`hizFoldTransparents`) builds
 * them after the front pass instead, from the depth that holds those
 * (`../../lighting/reflections/frame.ts`).
 */
const buildsTraceLayers = (rt: WebgpuPagesRuntime) =>
  !!rt.gpu.reflection && !readHizSetting(rt, 'hizFoldTransparents')

/** The pyramid built from the depth in the visibility buffer, which its first pass writes into level
 *  0, in a compute pass of its own: its culling layer, with its trace layers in the same dispatches
 *  where `full`. */
function encodePyramid(
  rt: WebgpuPagesRuntime,
  steps: ComputeRun,
  full: boolean,
  source: VisibilityRasterStages['depthSource'],
) {
  const hiz = prepared(rt.vis, 'gpuHiz')
  if (full) hiz.planes(readHizSetting(rt, 'hizTrace') === 'planes')
  const open = hizPass.begin(steps)
  hiz.encodeFromWork(open, source, full)
  hizPass.end()
  rt.run.hizPyramidFresh = true
}

/**
 * The visibility buffer, in the order of the cut's two-pass occlusion: the main pass's clusters —
 * hardware slots, then the software raster's (`raster.occluders`); the pyramid built from that
 * buffer, its level zero written with it; the cut's post pass, which judges against
 * it what the previous image's pyramid hid (`GpuSelection.encodePost`); the post pass's clusters
 * (`raster.rest`) and the pyramid built again from the whole depth, which the next image's main
 * pass reads, its trace layers (`buildsTraceLayers`) in the same dispatches; then the image closed (`raster.close`): the identifiers the software raster still has
 * to choose on a device without the 64-bit atomic maximum, and the export of the buffer into the
 * identifiers and the scene's depth (`../../frame/render/encodeVisSetup.ts`). A cut in one pass — a
 * view's first image, the occlusion turned off — draws everything in the first: the pyramid is
 * built once, from the whole depth, its trace layers with it. Both rasters write the one buffer by the one rule
 * (`visWriteWgsl`).
 */
export function encodeWebgpuVisibilityPasses(
  rt: WebgpuPagesRuntime,
  encoder: GPUCommandEncoder,
  raster: VisibilityRasterStages,
) {
  const { run } = rt
  const full = buildsTraceLayers(rt)
  // A cut in one pass leaves no post pass: this build is the only one, from the whole depth.
  const single = !twoPassOf(run.selectionUniforms)
  // The software depth and the pyramid follow one another: one compute pass, but on a
  // frame timed per pass.
  const steps = visibilitySteps.begin(encoder)
  raster.occluders(encoder, steps)
  rt.run.hizPyramidFresh = false
  encodePyramid(rt, steps, full && single, raster.depthSource)
  steps.end()
  // The drawn view's cut, the main one or its own aside (`../../geometry/dag/aside.ts`).
  const post = !!cutOf(rt)?.encodePost(encoder, cutPyramid(rt))
  // The only diagnostic variant that touches encoded commands: it leaves the post pass's clusters
  // out of the image to weigh the main pass's alone, and therefore yields an incomplete image.
  const withRest = post && !skipsSecondaryPass(rt.context?.diagnosticGpuVariant)
  if (withRest) {
    visibilitySteps.begin(encoder)
    raster.rest(encoder, visibilitySteps)
    encodePyramid(rt, visibilitySteps, full, raster.depthSource)
    visibilitySteps.end()
  } else if (full && !single) {
    encodePyramid(rt, visibilitySteps.begin(encoder), true, raster.depthSource)
    visibilitySteps.end()
  }
  // The pyramid holds the image's whole depth — but where the post pass's clusters were left out —:
  // what the view's next main pass tests against.
  notePyramidBuilt(rt, encoder, run.gate.cam, withRest || !post)
  raster.close(encoder, withRest)
  // Level 0 now holds every opaque pixel's depth.
  rt.run.depthDrawn = true
}
