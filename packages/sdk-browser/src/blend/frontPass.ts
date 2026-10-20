import { frontStamp } from '../lighting/reflections/frontLayer.ts'
import type { WebgpuPagesRuntime } from '../frame/backend/runtime.ts'
import { drawBlendRuns, type BlendRuns } from './draw.ts'

/** The front pass's runs: no reflection read, near to far — the depth it writes rejects early
 *  what lies behind (`BlendRuns`). */
const FRONT_RUNS: BlendRuns = { reflected: false, nearFirst: true }

/**
 * The transparents' front pass (`../lighting/reflections/frontLayer.ts`), the one producer of the nearest
 * transparent depth, after the transparents were prepared (`prepareBlend`) and bound (`bindBlend`), and
 * before the depth pyramid that folds it in and the trace that reads it: the opaque depth copied into the
 * layer's, then every transparent run of the image — the blends and the transmissive layers — drawn
 * through the front stage, on the blend group alone. It writes the covering depth into the Hi-Z front
 * layer, and, where a transparent of the scene reflects (`blendState.frontOutputs`), the reflecting surface
 * too — with its lobes where one carries them —, the store's front cells held from then on
 * (`holdFront`). None without transparents or a depth pyramid; a stage still compiling is asked, off the
 * frame, the frames held until it lands.
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
    !blendState.runCount
  )
    return
  const outputs = blendState.frontOutputs
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
