import type { ShadeClasses } from '../../visibility/passes/shadePipelines.ts'
import type { ShadeCensus } from '../../visibility/passes/shadeCensus.ts'
import { askGuidePass } from '../render/encodeGuides.ts'
import { askParticles } from '../../particles/gpu/webgpuParticleFrame.ts'
import { ensureGpuRaster } from '../render/encodeVisSetup.ts'
import { askPrimeHiz } from '../render/primeHiz.ts'
import { askComposedPlacements } from '../../placement/compose/gpuComposeFrame.ts'
import { askVisibleStages } from '../render/visibleTables.ts'
import { askRootPasses } from '../../placement/roots/rootPasses.ts'
import { askBlendReach } from '../../blend/askReach.ts'
import { askEntryCorners } from '../../blend/transparent/entryCorners.ts'
import { wantsEmissiveAo } from '../prepare/emissiveAoLayer.ts'
import { askLobedPrograms } from '../prepare/contractLight.ts'
import { askPerLightLights } from '../../lighting/shadows/vsm/frame/vsmAskProjection.ts'
import { wantsContractLighting } from '../prepare/lit.ts'
import { askBounce } from '../prepare/bounce.ts'
import { askAtmosphere } from '../render/encodeAtmosphere.ts'
import { askFogVolume } from '../render/encodeFogVolume.ts'
import { askTranslucencyVolume } from '../../lighting/translucency/frame.ts'
import { askTranslucencyGi } from '../../lighting/translucencyGi/frame.ts'
import { askScreenProbes } from '../../lighting/bounce/screen/frame.ts'
import { log } from '../../diagnostic/log.ts'
import { takeRefusals, tickCompiles, track } from '../../lighting/deferred/compileLedger.ts'
import {
  blueNoiseNow,
  blueNoiseRefused,
  blueNoiseTextures,
} from '../../gpu/noise/blueNoiseTextures.ts'
import { askExposure } from '../../post/exposure/frame.ts'
import { askFinish } from '../../post/finish/frame.ts'
import { askEffectPrograms } from '../../post/effects/stagePlan.ts'
import { askVelocity } from '../../post/taa/velocityFrame.ts'
import { askDisplacedClasses, displacedKeys } from '../../visibility/tessellation/prismFrame.ts'
import { presentClassKeys } from '../../gpu/core/presentClasses.ts'
import { takeGraphRefusals } from '../../materials/graph/kept.ts'
import { releaseGraphClasses } from '../../materials/graph/surfaceClasses.ts'
import { followGraphRasters } from '../prepare/lateGraphs.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'

/** The class set each census last asked its classes of. */
const asked = new WeakMap<ShadeCensus, ShadeClasses>()

/**
 * The census's classes, asked of the set in place once taken anew or once the set was replaced (a
 * feedback variant installed). Once the image needs the layer (`wantsEmissiveAo`: a surface of the census can emit or
 * occlude) and the set does not write it, they are asked of the set writing it (`withEmissiveAo`) alone, which
 * replaces the set once all are compiled. Nothing is read or allocated while nothing moved.
 */
function askShadeClasses(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { vis } = rt,
    census = vis.shadeCensus,
    classes = vis.shadeClasses
  if (!census || !classes) return
  const retaken = census.retake()
  // The classes of the graphs no worn surface needs any more give their keys back.
  if (retaken) {
    releaseGraphClasses(census.keys)
    classes.prune()
    // A graph that joined the session joins the set its modules hold before its classes are asked.
    followGraphRasters(rt, device, census)
  }
  if ((wantsEmissiveAo(rt) || vis.emissiveAoShown) && !vis.writesEmissiveAo) {
    const layered = classes.withEmissiveAo()
    let ready = true
    for (const key of census.keys) ready = layered.of(key).ask().ready && ready
    for (const key of displacedKeys(rt)) ready = layered.displaced(key).ask().ready && ready
    if (!ready) return
    // The drawn view's surfaces take the layer before the resolve (`followEmissiveAo`).
    vis.shadeClasses = layered
    vis.writesEmissiveAo = true
    asked.set(census, layered)
  } else if (retaken || asked.get(census) !== classes) {
    // The classes of an object that joined were compiled before it did (`placement/append/classGate.ts`); one asked here is a class a material changed into since.
    for (const key of census.keys) classes.of(key).ask()
    asked.set(census, classes)
  }
  // The capture of the surface cache's cards shades with its own twin (`cards`): the classes it
  // dispatches (`CardImage.classKeys`, the present ones) are asked once a cache stands.
  if (rt.surfaceCache) {
    const cards = vis.shadeClasses!.cards()
    for (const key of presentClassKeys(vis.presentClasses)) cards.of(key).ask()
  }
}

/** The engine's blue noise, asked of the device at a frame's entry once a lit image can read it (the shadow projection, the screen probes) or a surface dithers its cutout: the
 *  frames wait for it (`track`) while it is read and made, showing the previous image. Asked once: a refusal (the file missing, the budget) is
 *  the device's answer, and the passes that read it go without. */
function askBlueNoise(rt: WebgpuPagesRuntime, device: GPUDevice) {
  if ((!wantsContractLighting(rt) && !rt.vis.materialTable.dithers) || blueNoiseRefused(device))
    return
  if (blueNoiseNow(device) || blueNoiseRefused(device)) return
  track(device, blueNoiseTextures(device), true, 'blue noise')
}

/**
 * Asks, at a frame's entry, the pipelines the frame binds that something which entered the scene
 * since needs — a resolve class a material changed into, the classes writing the emission layer,
 * the guide pass once a guide is shown, the particles' routed draw, the seed of the share the
 * transparents write, the decode and the bins of the visible clusters, the transparent
 * entries' pass once a transparent table is made, the kernels
 * composing placements once a parent links placements, the roots' boxes and the tree's leaves — these
 * five once the session's cut is adopted, never queued ahead of its compiles —, the
 * lobe code of a lobed surface (`askLobedPrograms`), the bounce's probes once a lamp is on the GPU (`askBounce`), the per-light path's projection and lit pipelines (`askPerLightLights`), the transparent pass's responsiveness,
 * refraction, display-filter and holdout pipelines (`askBlendReach`), the atmosphere's passes once the scene
 * declares one (`askAtmosphere`), the fog's volume once the scene turns it on
 * (`askFogVolume`), the translucency lighting volume's once a blended surface is lit from it
 * (`askTranslucencyVolume`), the screen probes' kernels once the level casts them (`askScreenProbes`), the blue noise the shadows and the probes read (`askBlueNoise`), the automatic exposure's measure once an image
 * lit by declared lamps asks it (`askExposure`), the local exposure's passes once its settings
 * ask them (`askFinish`), the programs an effect pass that draws needs — the bloom's convolution
 * (`askEffectPrograms`) —, the velocity stage's program once a pass reads the motion
 * (`askVelocity`), the visibility raster once the targets it spans are made —,
 * each compiled off the thread (`PreparedPipeline.ask`): the frame is held while one compiles
 * (`deviceAnswering`), showing the previous image, never compiling one itself. Prepare asks them
 * the same way before the first frame. A session lost, or not prepared, asks nothing.
 */
export function askFramePipelines(rt: WebgpuPagesRuntime) {
  if (rt.gpu.device) {
    tickCompiles(rt.gpu.device)
    const refused = takeRefusals(rt.gpu.device)
    if (refused) {
      // Said on the console too: a refused pipeline leaves its pass undrawn, which with no
      // diagnostic channel open — the default — would leave nothing to read.
      log.warn(`WebGPU pipeline refused: ${refused.join(', ')}`)
      rt.diag.engineDiagnostic('pipeline-refused', 'The device refused to compile a pipeline', {
        pipelines: refused,
      })
    }
  }
  stampAsked(rt)
  askAll(rt)
}

/** What the last ask saw: the image and cut it was asked at, the three revisions, and what the asks
 *  read besides — the targets' views (a resize, a format or sample-count change makes them anew), the adopted cut's selection, the census's class set, the surface cache, the
 *  dithering flag. A new class, a variant of the settings or a lighting program moves one of them
 *  or a revision; a frame that moved none asks nothing the entry did not. */
type Asked = {
  image: number
  cut: number
  frame: number
  scene: number
  view: number
  res: number
  hdr: unknown
  depth: unknown
  selection: unknown
  classes: unknown
  cache: unknown
  dithers: boolean
}
const lastAsked = new WeakMap<WebgpuPagesRuntime, Asked>()

function stampAsked(rt: WebgpuPagesRuntime) {
  const { run, gpu, vis } = rt,
    { revisions } = run.gate
  let at = lastAsked.get(rt)
  if (!at) lastAsked.set(rt, (at = {} as Asked))
  at.image = run.imageRevision
  at.cut = run.cutEpoch
  at.frame = run.frame
  at.scene = revisions.scene
  at.view = revisions.view
  at.res = revisions.resources
  at.hdr = gpu.hdrView
  at.depth = gpu.depthView
  at.selection = run.gpuSelection
  at.classes = vis.shadeClasses
  at.cache = rt.surfaceCache
  at.dithers = vis.materialTable.dithers
}

/** The ask again where the frame moved since the entry's: a held frame, which drew nothing and
 *  moved nothing the asks read, asks what the entry just asked, and nothing more. */
export function askFramePipelinesMoved(rt: WebgpuPagesRuntime) {
  const at = lastAsked.get(rt),
    { run, gpu, vis } = rt,
    { revisions } = run.gate
  if (
    at &&
    at.image === run.imageRevision &&
    at.cut === run.cutEpoch &&
    at.frame === run.frame &&
    at.scene === revisions.scene &&
    at.view === revisions.view &&
    at.res === revisions.resources &&
    at.hdr === gpu.hdrView &&
    at.depth === gpu.depthView &&
    at.selection === run.gpuSelection &&
    at.classes === vis.shadeClasses &&
    at.cache === rt.surfaceCache &&
    at.dithers === vis.materialTable.dithers
  )
    return
  askFramePipelines(rt)
}

function askAll(rt: WebgpuPagesRuntime) {
  const device = rt.gpu.device
  if (!device || rt.run.lost) return
  for (const reason of takeGraphRefusals())
    rt.diag.engineDiagnostic('material-graph-refused', 'A material graph was refused', { reason })
  askShadeClasses(rt, device)
  askDisplacedClasses(rt)
  askGuidePass(rt, device)
  askParticles(rt, device)
  // The passes beside the cut — the decode and the bins of its clusters, the transparent entries,
  // the composition, the roots — once it is adopted: asked before, they would queue ahead of its own
  // compiles.
  if (rt.run.gpuSelection) {
    askVisibleStages(rt, device)
    askEntryCorners(rt, device)
    askComposedPlacements(rt, device)
    askRootPasses(rt, device)
    // The per-light path's pipelines (`askPerLightLights`), beside the cut's: asked once the cut is adopted too.
    askPerLightLights(rt, device)
  }
  askLobedPrograms(rt, device)
  askBounce(rt, device)
  askBlendReach(rt)
  askAtmosphere(rt, device)
  askFogVolume(rt, device)
  askTranslucencyVolume(rt, device)
  askTranslucencyGi(rt, device)
  askBlueNoise(rt, device)
  askScreenProbes(rt, device)
  askExposure(rt, device)
  askFinish(rt, device)
  askEffectPrograms(rt, device)
  askVelocity(rt, device)
  if (rt.gpu.depthView) ensureGpuRaster(rt, device)
  // The primed pyramid's targets and kernel, once a view asks one (`hizPrime`).
  askPrimeHiz(rt)
}
