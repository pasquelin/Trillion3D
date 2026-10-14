import { createCheckedShaderModule } from '../../gpu/core/shaderModule.ts'
import { makeFullscreenPipeline } from '../../lighting/deferred/fullscreen.ts'
import { computeTextureEntry } from '../../gpu/core/computeBindings.ts'
import { BLOOM_PASS } from '../../stage/passLabels.ts'
import { HDR_FORMAT } from '../../scene/targetFormats.ts'
import { BLOOM_WGSL } from './bloomWgsl.ts'
import { bloomLevelLayout } from './bloomLevel.ts'
import { ADD_ONE } from '../blend/equations.ts'

/** The bloom's three programs (`webgpuBloom.ts`) — down a level, back up adding, the composite —,
 *  their group layouts and the one sampler they share. */
export async function createBloomPrograms(device: GPUDevice) {
  const visibility = GPUShaderStage.FRAGMENT
  const imageLayout = device.createBindGroupLayout({
    label: `${BLOOM_PASS} scene`,
    entries: [computeTextureEntry(0, 'unfilterable-float', '2d', visibility)],
  })
  const layouts = { level: bloomLevelLayout(device), scene: imageLayout }
  const module = await createCheckedShaderModule(device, BLOOM_WGSL, BLOOM_PASS)
  const [down, up, composite] = await Promise.all([
    makeFullscreenPipeline(device, module, layouts.level, 'down', [{ format: HDR_FORMAT }]),
    makeFullscreenPipeline(device, module, layouts.level, 'up', [
      { format: HDR_FORMAT, blend: { color: ADD_ONE, alpha: ADD_ONE } },
    ]),
    makeFullscreenPipeline(device, module, [layouts.level, layouts.scene], 'composite', [
      { format: HDR_FORMAT },
    ]),
  ])
  const sampler = device.createSampler({
    label: `${BLOOM_PASS} sampler`,
    magFilter: 'linear',
    minFilter: 'linear',
  }) // clamped to the edge, the default address mode
  return { layouts, down, up, composite, sampler }
}
