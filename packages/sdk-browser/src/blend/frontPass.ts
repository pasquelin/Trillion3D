import { frontStamp } from '../lighting/reflections/frontLayer.ts'
import type { WebgpuPagesRuntime } from '../frame/backend/runtime.ts'
import { readHizSetting } from '../../../sdk-core/src/contracts/hizOptions.ts'
import { drawBlendRuns, type BlendRuns } from './draw.ts'
import { waterFrontOf } from './water/waterReflection.ts'
import { tracesTranslucent } from '../lighting/shadows/vsm/frame/vsmGates.ts'

/** The front pass's runs: no reflection read, near to far — the depth it writes rejects early
 *  what lies behind (`BlendRuns`). */
const FRONT_RUNS: BlendRuns = { reflected: false, nearFirst: true, water: 'with' }

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
 * (`hizFoldTransparents`) or the shadow pages the translucent surfaces mark (`shadowTranslucentQuality` 1,
 * `markingFrontLayer`); a stage still compiling is asked, off the frame, the frames held until it lands.
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
  if (!frontLayer && !readHizSetting(rt, 'hizFoldTransparents') && !tracesTranslucent(rt)) return
  // The reflecting surface is written only where the trace answers the front layer (`ReflectionSettings.frontLayer`): else the
  // covering depth alone, which the depth pyramid folds in.
  const outputs = frontLayer ? blendState.frontOutputs : 0
  const set = vis.blendPipelines.front(outputs)
  if (!set.ready) return set.ask()
  const hizFront = hiz.front(true)
  if (!hizFront) return
  const { front } = reflection
  encoder.copyTextureToTexture({ texture: gpu.depthTexture }, { texture: front.depth }, [
    front.depth.width,
    front.depth.height,
  ])
  const pass = encoder.beginRenderPass(front.begin(frontStamp(run.frame), hizFront, outputs, gpu))
  pass.setViewport(0, 0, gpu.targetSize[0], gpu.targetSize[1], 0, 1)
  run.gpuDrawCalls += drawBlendRuns(rt, device, pass, set, FRONT_RUNS)
  pass.end()
}
