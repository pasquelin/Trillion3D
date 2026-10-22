import type { Bloom } from '../../../../../sdk-core/src/world/effect/bloom.ts'
import type { BloomValues } from '../../../../../sdk-core/src/contracts/bloomRules.ts'
import type { PostFrame } from '../../finish/finish.ts'
import type { createBloomPrograms } from './bloomPrograms.ts'
import { createGaussianGlow } from './bloomGaussian.ts'
import type { BloomTargets } from './bloomTargets.ts'
import { createConvolution } from './convolution/convolutionSet.ts'
import type { Vec4 } from './convolution/kernelStats.ts'

/** A bloom's passes (`createBloomSet`). */
export type BloomSet = ReturnType<typeof createBloomSet>

type BloomPrograms = Awaited<ReturnType<typeof createBloomPrograms>>

/** A bloom's convolution, made at the first image that asks for it and given back by `drop`. */
function createConvolutionSlot(device: GPUDevice, targets: BloomTargets) {
  let held: ReturnType<typeof createConvolution> | undefined
  return {
    encode(...args: Parameters<ReturnType<typeof createConvolution>['encode']>) {
      held ??= createConvolution(device, targets.convolution)
      return held.encode(...args)
    },
    drop() {
      held?.dispose()
      held = undefined
    },
    get bytes() {
      return held?.bytes ?? 0
    },
  }
}

/**
 * ONE BLOOM'S PASSES, over the images the chain's blooms share (`BloomTargets`), by the bloom's
 * method: the Gaussian glow (`createGaussianGlow`) or the convolution's (`createConvolution`), made
 * on the first image that asks for it and given back when the bloom changes method. A bloom holds
 * its own uniforms and bind groups, kept while the size and its settings hold, and a frame allocates
 * none.
 */
export function createBloomSet(device: GPUDevice, programs: BloomPrograms, targets: BloomTargets) {
  const gaussian = createGaussianGlow(device, programs, targets)
  const convolution = createConvolutionSlot(device, targets)
  const set = {
    /** The glow the last `encode` drew, none when nothing drew. */
    view: undefined as GPUTextureView | undefined,
    /** What the image keeps of its light under the last convolution, none for a Gaussian glow. */
    tint: undefined as Vec4 | undefined,
    /** Whether the last `encode` drew a convolution. */
    usedConvolution: false,
    /** Whether the last `encode` drew a setup, and so the chain under it. */
    get usedSetup() {
      return gaussian.usedSetup
    },
    /** Bytes the convolution's kernel holds. */
    get bytes() {
      return convolution.bytes
    },
    /**
     * Draws `bloom`'s glow over `image`, the frame's image, as `settings` ask, the scene's chain
     * `post` shares; returns the passes drawn, 0 when nothing draws: the quality off, every level
     * left out, a kernel of no light.
     */
    encode(
      encoder: GPUCommandEncoder,
      bloom: Bloom,
      post: PostFrame,
      settings: BloomValues,
      image: GPUTextureView,
    ) {
      set.view = set.tint = undefined
      set.usedConvolution = false
      gaussian.reset()
      if (settings.bloomQuality === 'off') return 0
      if (bloom.method !== 'convolution') {
        convolution.drop()
        const drawn = gaussian.encode(encoder, bloom, post, settings)
        set.view = gaussian.view
        return drawn
      }
      const made = convolution.encode(encoder, bloom, post, settings, image)
      if (!made) return 0
      set.usedConvolution = true
      set.view = made.glow
      set.tint = made.sceneTint
      return made.passes
    },
    dispose() {
      gaussian.dispose()
      convolution.drop()
      set.view = set.tint = undefined
    },
  }
  return set
}
