import type { Bloom } from '../../../../../sdk-core/src/world/effect/bloom.ts'
import { BLOOM_RULES } from '../../../../../sdk-core/src/contracts/bloomRules.ts'
import { readSetting } from '../../../../../sdk-core/src/contracts/settingRules.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'
import { wanted } from '../../finish/frame.ts'
import { askConvolutionPrograms } from './convolution/convolutionPrograms.ts'
import { dirtShows } from './glowFinish.ts'
import { askGlowPrograms } from './glowPrograms.ts'

/**
 * Asks the programs the chain's blooms need beyond the Gaussian glow's — the convolution's, and the
 * finishing of a glow that has a dirt mask or a convolution — of `device` off the frame, once a bloom
 * that draws asks them, the frames held until they landed (`../../../frame/loop/framePipelines.ts`).
 * Nothing for a chain whose blooms draw the plain Gaussian glow: it costs nothing then. The quality
 * is read without the image's watch (`bloomValues`), whose reading a hold's test depends on.
 */
export function askBloomPrograms(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const chain = rt.context.effects
  if (!chain || !wanted(rt) || readSetting(BLOOM_RULES, rt.context, 'bloomQuality') === 'off')
    return
  for (const pass of chain.stage('before-tone-mapping')) {
    if (pass.kind !== 'bloom' || pass.idle) continue
    const bloom = pass as Bloom
    const convolves = bloom.method === 'convolution'
    if (convolves) askConvolutionPrograms(device)
    if (convolves || dirtShows(bloom.dirtMask, bloom.intensity)) askGlowPrograms(device)
  }
}
