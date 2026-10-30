import { frontStamp, type FrontOutputs } from '../lighting/reflections/frontLayer.ts'
import { beginFrontTiles, FRONT_TILE_GROUP } from '../lighting/reflections/frontTiles.ts'
import type { WebgpuPagesRuntime } from '../frame/backend/runtime.ts'
import { readHizSetting } from '../../../sdk-core/src/contracts/hizOptions.ts'
import { drawBlendRuns, type BlendRuns } from './draw.ts'
import { waterFrontOf } from './water/waterReflection.ts'
import { waterTableGroup } from './water/waterExclusions.ts'
import { WATER_GROUP } from './water/waterLayout.ts'
import { emptyGroup } from './transmission/distortionGroups.ts'
import { REFLECTION_GROUP } from '../lighting/reflections/viewLayout.ts'
import { lightsFrontLayer } from '../lighting/manyLightsSampled/frame.ts'
import { tracesTranslucent } from '../lighting/shadows/vsm/frame/vsmGates.ts'
import { tracedTranslucencyTraced } from '../lighting/reflections/translucency/stage.ts'

/** The front pass's runs: no reflection read, near to far — the depth it writes rejects early
 *  what lies behind (`BlendRuns`). */
const FRONT_RUNS: BlendRuns = { reflected: false, nearFirst: true, water: 'with' }
/** The same in two runs where the water's surface is cut: the others, then the water's. */
const FRONT_RUNS_PLAIN: BlendRuns = { reflected: false, nearFirst: true }
const FRONT_RUNS_WATER: BlendRuns = { reflected: false, nearFirst: true, water: 'only' }

/**
 * The transparents' front pass (`../lighting/reflections/frontLayer.ts`), the one producer of the nearest
 * transparent depth, after the transparents were prepared (`prepareBlend`) and bound (`bindBlend`), and
 * before the depth pyramid that folds it in and the trace that reads it: the opaque depth copied into the
 * layer's, then every transparent run of the image — the blends and the transmissive layers — drawn
 * through the front stage, on the blend group alone. It writes the covering depth into the Hi-Z front
 * layer, and, where a transparent of the scene reflects (`blendState.frontOutputs`) and the settings trace the front layer
 * (`reflectionFrontLayer`, off by default: `reflectionOptions.ts`), the reflecting surface
 * too — with its lobes where one carries them —, the store's front cells held from then on
 * (`holdFront`). None without transparents or a depth pyramid, and none unless a feature reads the layer it
 * writes: the front layer's reflections (`reflectionFrontLayer`), the depth pyramid's fold of the transparents
 * (`hizFoldTransparents`), the shadow pages the translucent surfaces mark (`shadowTranslucentQuality` 1,
 * `markingFrontLayer`) or the traced translucency, which casts its rays where the layer covers the opaque depth (`tracedTranslucencyTraced`); a stage still compiling is asked, off the frame, the frames held until it lands.
 * Drawn once an image: before the lights where the marking has no front layer of the image before to
 * read (`drawsFrontBeforeMarking`, `encodeMarkedLayers`), the call after them then draws nothing.
 */
export function encodeFrontPass(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
) {
  const { gpu, vis, run, blendState } = rt,
    reflection = gpu.reflection,
    hiz = vis.gpuHiz
  if (
    !reflection?.front.wanted ||
    !hiz ||
    !gpu.depthTexture ||
    !vis.blendPipelines ||
    !blendState.runCount ||
    reflection.front.drawn === frontStamp(run.frame)
  )
    return
  const { frontLayer } = reflection.settings(rt.context, waterFrontOf(rt))
  const sampledFront = lightsFrontLayer(rt)
  if (
    !frontLayer &&
    !sampledFront &&
    !readHizSetting(rt, 'hizFoldTransparents') &&
    !tracesTranslucent(rt) &&
    !tracedTranslucencyTraced(rt)
  )
    return
  // The reflecting surface is written only where the trace answers the front layer (`ReflectionSettings.frontLayer`) or the sampled lighting lights it
  // (`sampledLightsFrontLayer`, which also takes its base colour, of every lit model): else the covering depth alone, which the depth pyramid folds in.
  // The traced translucency's denoiser reads the layer's normal and roughness.
  const outputs: FrontOutputs =
    blendState.frontLit && sampledFront
      ? 3
      : frontLayer || tracedTranslucencyTraced(rt)
        ? (Math.max(blendState.frontOutputs, 1) as FrontOutputs)
        : 0
  const set = vis.blendPipelines.front(outputs)
  if (!set.ready) return set.ask()
  // The water's items are drawn apart where the programs cut its surface inside an exclusion volume: their stage reads the volumes' table.
  const cutSet = vis.blendPipelines.water?.exclusion
    ? vis.blendPipelines.front(outputs, true)
    : undefined
  if (cutSet && !cutSet.ready) return cutSet.ask()
  const hizFront = hiz.front(true)
  if (!hizFront) return
  const { front } = reflection
  encoder.copyTextureToTexture({ texture: gpu.depthTexture }, { texture: front.depth }, [
    front.depth.width,
    front.depth.height,
  ])
  const descriptor = front.begin(frontStamp(run.frame), hizFront, outputs, gpu)
  // The surface written only for the sampled lighting is not one the reflections trace.
  if (!frontLayer) front.reflected = 0
  // The tiles the layer lights start empty where the pass that marks them begins.
  const tiles = outputs === 3 ? front.tiles : undefined
  if (tiles) beginFrontTiles(encoder, tiles)
  const pass = encoder.beginRenderPass(descriptor)
  if (tiles) pass.setBindGroup(FRONT_TILE_GROUP, tiles.maskGroup)
  pass.setViewport(0, 0, gpu.targetSize[0], gpu.targetSize[1], 0, 1)
  if (cutSet) {
    run.gpuDrawCalls += drawBlendRuns(rt, device, pass, set, FRONT_RUNS_PLAIN)
    // The group of the reflection's place holds nothing here, as it does in the water's depth pass.
    if (!tiles) pass.setBindGroup(REFLECTION_GROUP, emptyGroup(device))
    pass.setBindGroup(WATER_GROUP, waterTableGroup(rt, device))
    run.gpuDrawCalls += drawBlendRuns(rt, device, pass, cutSet, FRONT_RUNS_WATER)
  } else run.gpuDrawCalls += drawBlendRuns(rt, device, pass, set, FRONT_RUNS)
  pass.end()
  if (outputs === 3) front.surfaceFrom(encoder)
}
