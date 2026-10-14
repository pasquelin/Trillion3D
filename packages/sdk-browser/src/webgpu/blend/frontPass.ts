import { wantsContractLighting } from '../pages/prepare/contractLight.ts'
import { frontStamp } from '../../reflections/frontLayer.ts'
import type { ContractKey } from '../../lighting/deferred/contractCuts.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'
import { drawBlendRuns } from './draw.ts'

/**
 * The transparents' front pass (`../../reflections/frontLayer.ts`), before the reflection trace that
 * reads it: the opaque depth copied into the front's, then every transparent run of the image — the
 * blends and the transmissive slice — drawn through the front stage of the program the frame lights the
 * blends with (`key`), its lobes target attached where that program writes lobes. Only where the view
 * holds the proxy's store with a front layer, the image is lit and traced, a beauty view, and its
 * transparents were prepared (`prepareBlend`, the caller's): elsewhere no pass, and the image's stamp is
 * never the layer's, so no fragment reads it. Returns whether it drew.
 */
export function encodeFrontPass(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  key: Partial<ContractKey>,
) {
  const { gpu, vis, run, blendState } = rt,
    front = gpu.reflection?.store.front
  if (
    !front ||
    !gpu.depthTexture ||
    !vis.blendPipelines ||
    !vis.reflectionPipelines ||
    run.diagnostic !== 'beauty' ||
    !wantsContractLighting(rt) ||
    (!blendState.runCount[0] && !blendState.runCount[1])
  )
    return false
  const set = vis.blendPipelines.lit(key, blendState.lobed || blendState.waterLobed).front
  // Compiled off the frame at its first ask, the frames held until then: no image draws without it.
  if (!set.ready) {
    set.ask()
    return false
  }
  encoder.copyTextureToTexture({ texture: gpu.depthTexture }, { texture: front.depth }, [
    front.depth.width,
    front.depth.height,
  ])
  const pass = encoder.beginRenderPass(front.begin(frontStamp(run.frame), set.lobes, gpu))
  pass.setViewport(0, 0, gpu.targetSize[0], gpu.targetSize[1], 0, 1)
  for (const slice of [0, 1])
    if (blendState.runCount[slice]) run.gpuDrawCalls += drawBlendRuns(rt, device, pass, slice, set)
  pass.end()
  return true
}
