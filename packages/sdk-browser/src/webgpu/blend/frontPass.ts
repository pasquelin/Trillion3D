import { frontStamp } from '../../reflections/frontLayer.ts'
import { frontOutputsOf } from './frontStage.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'
import { drawBlendRuns } from './draw.ts'

/**
 * The transparents' front pass (`../../reflections/frontLayer.ts`), the one producer of the nearest
 * transparent depth, after the transparents were prepared (`prepareBlend`) and bound (`bindBlend`), and
 * before the depth pyramid that folds it in and the trace that reads it: the opaque depth copied into the
 * layer's, then every transparent run of the image — the blends and the transmissive slice — drawn
 * through the front stage, on the blend group alone. It writes the covering depth into the Hi-Z front
 * layer, and, where a transparent of the scene reflects (`blendState.reflects`), the reflecting surface
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
    (!blendState.runCount[0] && !blendState.runCount[1])
  )
    return
  const outputs = frontOutputsOf(blendState.reflects, blendState.lobed || blendState.waterLobed)
  const set = vis.blendPipelines.front(outputs)
  if (!set.ready) return set.ask()
  const hizFront = hiz.front(encoder, true)
  if (!hizFront) return
  const { front } = reflection
  if (outputs > 0) gpu.targetBytes += reflection.store.holdFront()
  encoder.copyTextureToTexture({ texture: gpu.depthTexture }, { texture: front.depth }, [
    front.depth.width,
    front.depth.height,
  ])
  const pass = encoder.beginRenderPass(front.begin(frontStamp(run.frame), hizFront, outputs, gpu))
  pass.setViewport(0, 0, gpu.targetSize[0], gpu.targetSize[1], 0, 1)
  for (const slice of [0, 1])
    if (blendState.runCount[slice])
      run.gpuDrawCalls += drawBlendRuns(rt, device, pass, slice, set, undefined, false, false)
  pass.end()
}
