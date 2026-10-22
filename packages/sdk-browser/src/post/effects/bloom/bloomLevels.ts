import type { Bloom } from '../../../../../sdk-core/src/world/effect/bloom.ts'
import { BLOOM_LEVEL_COUNT } from '../../../../../sdk-core/src/contracts/bloomOptions.ts'
import { createGaussianStage } from '../../filters/gaussianStage.ts'
import { BLOOM_LEVEL_LEAST, bloomTintScale } from './bloomFilter.ts'
import type { BloomTargets } from './bloomTargets.ts'

/** The images of the scene's chain, or of the chain under the setup's: the size and the view of
 *  each level. */
export type Levels = {
  size(level: number): readonly number[]
  view(level: number): GPUTextureView | undefined
}

/** The finest level from `first` on that draws — its size past `BLOOM_LEVEL_LEAST` —, -1 when none
 *  does. */
export function finestLevel(levels: Bloom['levels'], first = 0) {
  for (let level = first; level < BLOOM_LEVEL_COUNT; level++)
    if (levels[level].size > BLOOM_LEVEL_LEAST) return level
  return -1
}

/**
 * THE BLURS OF A BLOOM'S LEVELS: a Gaussian stage for each, over the targets the chain's blooms
 * share (`BloomTargets`). `draw` blurs each level that draws, widest first, the stage's sum adding
 * the one below's glow, tinted.
 */
export function createBloomLevels(device: GPUDevice, targets: BloomTargets) {
  const stages = targets.stages.map((shared) =>
    createGaussianStage(device, { edge: 'zero', targets: shared }),
  )
  const tint = [0, 0, 0]
  return {
    /** The blur of `level`, at the size of that level. */
    view: (level: number) => stages[level].view,
    /**
     * Blurs each level of `bloom` from `first` on that draws, its image `from.view(level)` — the
     * level 0's is `image` —, the glow scaled by `bloom.intensity × bloom.gaussianIntensity` over the
     * six levels, the centre of the two passes of each given the shares `cross`; returns the render
     * passes drawn.
     */
    draw(
      encoder: GPUCommandEncoder,
      bloom: Bloom,
      from: Levels,
      image: GPUTextureView,
      first: number,
      cross: readonly number[],
    ) {
      const scale = bloomTintScale(bloom.intensity * bloom.gaussianIntensity)
      let below: GPUTextureView | undefined,
        drawn = 0
      for (let level = BLOOM_LEVEL_COUNT - 1; level >= first; level--) {
        const { size, tint: color } = bloom.levels[level]
        if (!(size > BLOOM_LEVEL_LEAST)) continue
        const across = from.size(level)
        for (let c = 0; c < 3; c++) tint[c] = color[c] * scale
        stages[level].resize(across[0], across[1], size * bloom.sizeScale, tint, !!below, cross)
        stages[level].encode(encoder, level ? from.view(level)! : image, below)
        below = stages[level].view
        drawn += 2
      }
      return drawn
    },
    dispose() {
      for (const stage of stages) stage.dispose()
    },
  }
}
