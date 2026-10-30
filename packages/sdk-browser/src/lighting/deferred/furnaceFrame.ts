import { readShadingSetting } from '../../../../sdk-core/src/contracts/shadingOptions.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'

/**
 * The shading furnace test of an image (`shadingFurnaceTest`, run only where `shadingFurnaceTestEnableForProject` is true), once everything
 * the scene writes into the lit image is in it (the lights, the sky, the fog, the transparents, the volumes) and before the image goes
 * through the temporal pass and the display chain: every pixel is replaced by what its surface returns in a uniform environment
 * (`furnaceWgsl.ts`). Nothing where the setting is off or the frame is not lit.
 */
export function encodeShadingFurnace(rt: WebgpuPagesRuntime, encoder: GPUCommandEncoder) {
  const { deferred, hdrView } = rt.gpu
  if (
    !deferred ||
    !hdrView ||
    !readShadingSetting(rt, 'shadingFurnaceTest') ||
    !readShadingSetting(rt, 'shadingFurnaceTestEnableForProject')
  )
    return
  deferred.furnace(encoder, hdrView, readShadingSetting(rt, 'shadingFurnaceTestSampleCount'))
}
