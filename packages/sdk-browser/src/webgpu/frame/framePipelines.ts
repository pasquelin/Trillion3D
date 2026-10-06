import type { ShadeClasses } from '../visibility/shadePipelines.ts'
import type { ShadeCensus } from '../visibility/shadeCensus.ts'
import { askGuidePass } from '../pages/render/encodeGuides.ts'
import { askAsIsSeed } from '../../lighting/deferred/asIsShare.ts'
import { askParticles } from '../particles/webgpuParticleFrame.ts'
import { wantsAsIsShare } from '../pages/prepare/asIsShareTarget.ts'
import { ensureGpuRaster } from '../pages/render/encodeVisSetup.ts'
import { requestsComputeRaster } from '../../diagnostic/gpuGeometry.ts'
import { askComposedPlacements } from '../../placement/gpuCompose.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'

/** The class set each census last asked its classes of. */
const asked = new WeakMap<ShadeCensus, ShadeClasses>()

/**
 * The census's classes, asked of the set in place once taken anew or once the set was replaced (a
 * feedback variant installed). Once a surface of the census can emit or occlude and the set does
 * not write the layer, they are asked of the set writing it (`withEmissiveAo`) alone, which
 * replaces the set once all are compiled. Nothing is read or allocated while nothing moved.
 */
function askShadeClasses(rt: WebgpuPagesRuntime) {
  const { vis } = rt,
    census = vis.shadeCensus,
    classes = vis.shadeClasses
  if (!census || !classes) return
  const retaken = census.retake()
  if (census.emits && !vis.writesEmissiveAo) {
    const layered = classes.withEmissiveAo()
    let ready = true
    for (const key of census.keys) {
      ready = layered.of(key).ask().ready && ready
      layered.single(key)?.ask()
    }
    if (!ready) return
    // The drawn view's surfaces take the layer before the resolve (`followEmissiveAo`).
    vis.shadeClasses = layered
    vis.writesEmissiveAo = true
    asked.set(census, layered)
  } else if (retaken || asked.get(census) !== classes) {
    for (const key of census.keys) {
      classes.of(key).ask()
      classes.single(key)?.ask()
    }
    asked.set(census, classes)
  }
}

/**
 * Asks, at a frame's entry, the pipelines the frame binds that something which entered the scene
 * since needs — a resolve class a material changed into, the classes writing the emission layer,
 * the guide pass once a guide is shown, the particles' routed draw, the seed of the share the
 * transparents and particles write, the kernels composing placements once a parent links rows, the
 * compute raster a variant asks for on a visibility path —,
 * each compiled off the thread (`PreparedPipeline.ask`): the frame is held while one compiles
 * (`deviceAnswering`), showing the previous image, never compiling one itself. Prepare asks them
 * the same way before the first frame. A session lost, or not prepared, asks nothing.
 */
export function askFramePipelines(rt: WebgpuPagesRuntime) {
  const device = rt.gpu.device
  if (!device || rt.run.lost) return
  askShadeClasses(rt)
  askGuidePass(rt, device)
  askParticles(rt, device)
  if (wantsAsIsShare(rt)) askAsIsSeed(device)
  askComposedPlacements(rt, device)
  if (
    rt.vis.visEnabled &&
    requestsComputeRaster(rt.context?.diagnosticGpuVariant) &&
    typeof device.createComputePipeline === 'function'
  )
    ensureGpuRaster(rt, device)
}
