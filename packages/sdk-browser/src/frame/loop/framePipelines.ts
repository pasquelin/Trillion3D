import type { ShadeClasses } from '../../visibility/passes/shadePipelines.ts'
import type { ShadeCensus } from '../../visibility/passes/shadeCensus.ts'
import { askGuidePass } from '../render/encodeGuides.ts'
import { askAsIsSeed } from '../../lighting/deferred/asIsShare.ts'
import { askParticles } from '../../particles/gpu/webgpuParticleFrame.ts'
import { wantsAsIsShare } from '../prepare/asIsShareTarget.ts'
import { ensureGpuRaster } from '../render/encodeVisSetup.ts'
import { askPrimeHiz } from '../render/primeHiz.ts'
import { askComposedPlacements } from '../../placement/compose/gpuComposeFrame.ts'
import { askRowWords } from '../../placement/rows/rowWordsPass.ts'
import { askRootPasses } from '../../placement/roots/rootPasses.ts'
import { askEntryCorners } from '../../blend/transparent/entryCorners.ts'
import { wantsEmissiveAo } from '../prepare/emissiveAoLayer.ts'
import { askLobedPrograms } from '../prepare/contractLight.ts'
import { askAtmosphere } from '../render/encodeAtmosphere.ts'
import { askFogVolume } from '../render/encodeFogVolume.ts'
import { askScreenProbes } from '../../lighting/bounce/screen/frame.ts'
import { askExposure } from '../../post/exposure/frame.ts'
import { askFinish } from '../../post/finish/frame.ts'
import { askBloomPrograms } from '../../post/effects/bloom/bloomAsk.ts'
import { askVelocity } from '../../post/taa/velocityFrame.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'

/** The class set each census last asked its classes of. */
const asked = new WeakMap<ShadeCensus, ShadeClasses>()

/**
 * The census's classes, asked of the set in place once taken anew or once the set was replaced (a
 * feedback variant installed). Once the image needs the layer (`wantsEmissiveAo`: a surface of the census can emit or
 * occlude) and the set does not write it, they are asked of the set writing it (`withEmissiveAo`) alone, which
 * replaces the set once all are compiled. Nothing is read or allocated while nothing moved.
 */
function askShadeClasses(rt: WebgpuPagesRuntime) {
  const { vis } = rt,
    census = vis.shadeCensus,
    classes = vis.shadeClasses
  if (!census || !classes) return
  const retaken = census.retake()
  if (wantsEmissiveAo(rt) && !vis.writesEmissiveAo) {
    const layered = classes.withEmissiveAo()
    let ready = true
    for (const key of census.keys) ready = layered.of(key).ask().ready && ready
    if (!ready) return
    // The drawn view's surfaces take the layer before the resolve (`followEmissiveAo`).
    vis.shadeClasses = layered
    vis.writesEmissiveAo = true
    asked.set(census, layered)
  } else if (retaken || asked.get(census) !== classes) {
    for (const key of census.keys) classes.of(key).ask()
    asked.set(census, classes)
  }
}

/**
 * Asks, at a frame's entry, the pipelines the frame binds that something which entered the scene
 * since needs — a resolve class a material changed into, the classes writing the emission layer,
 * the guide pass once a guide is shown, the particles' routed draw, the seed of the share the
 * transparents and particles write, the rows pass once the table holds a row and its transparent
 * entries' pass once a transparent table is made, the kernels
 * composing placements once a parent links rows, the roots' boxes and the tree's leaves — these
 * four once the session's cut is adopted, never queued ahead of its compiles —, the
 * lobe code of a lobed surface (`askLobedPrograms`), the atmosphere's passes once the scene
 * declares one (`askAtmosphere`), the fog's volume once the scene turns it on
 * (`askFogVolume`), the screen probes' kernels once the level casts them (`askScreenProbes`), the automatic exposure's measure once an image
 * lit by declared lamps asks it (`askExposure`), the local exposure's passes once its settings
 * ask them (`askFinish`), the bloom's convolution and the finishing of its glow once a bloom
 * draws one (`askBloomPrograms`), the velocity stage's program once a pass reads the motion
 * (`askVelocity`), the visibility raster once the targets it spans are made —,
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
  // The passes beside the cut — the rows, the transparent entries, the composition, the roots —
  // once it is adopted: asked before, they would queue ahead of its own compiles.
  if (rt.run.gpuSelection) {
    askRowWords(rt, device)
    askEntryCorners(rt, device)
    askComposedPlacements(rt, device)
    askRootPasses(rt, device)
  }
  askLobedPrograms(rt, device)
  askAtmosphere(rt, device)
  askFogVolume(rt, device)
  askScreenProbes(rt, device)
  askExposure(rt, device)
  askFinish(rt, device)
  askBloomPrograms(rt, device)
  askVelocity(rt, device)
  if (rt.gpu.depthView) ensureGpuRaster(rt, device)
  // The primed pyramid's targets and kernel, once a view asks one (`hizPrime`).
  askPrimeHiz(rt)
}
