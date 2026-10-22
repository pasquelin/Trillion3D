import type { Bloom } from '../../../../../sdk-core/src/world/effect/bloom.ts'
import { BLOOM_LEVEL_COUNT } from '../../../../../sdk-core/src/contracts/bloomOptions.ts'
import {
  BLOOM_QUALITY_STAGES,
  type BloomValues,
} from '../../../../../sdk-core/src/contracts/bloomRules.ts'
import type { PostFrame } from '../../finish/finish.ts'
import type { createBloomPrograms } from './bloomPrograms.ts'
import { createBloomLevels, finestLevel } from './bloomLevels.ts'
import { createBloomSetup } from './bloomSetup.ts'
import type { BloomTargets } from './bloomTargets.ts'

type BloomPrograms = Awaited<ReturnType<typeof createBloomPrograms>>

/** The widest levels the quality keeps (`BLOOM_QUALITY_STAGES`): the first of the six that draws. */
const firstLevelOf = (quality: BloomValues['bloomQuality']) =>
  quality === 'off' ? BLOOM_LEVEL_COUNT : BLOOM_LEVEL_COUNT - BLOOM_QUALITY_STAGES[quality]

/**
 * THE GAUSSIAN GLOW OF ONE BLOOM, over the images the chain's blooms share (`BloomTargets`): the
 * half-size image is brought through a setup — its local exposure applied where the settings keep it,
 * and a threshold, when either is asked — into the levels of the setup's chain, or, when neither,
 * read from the scene's chain as it is (`PostFrame`, shared with the local exposure). Each level the
 * quality keeps that draws is blurred (`createBloomLevels`), widest first, the stage's sum adding the
 * one below's, the centre of each pass given the cross's share: the glow is the finest level's.
 */
export function createGaussianGlow(
  device: GPUDevice,
  programs: BloomPrograms,
  targets: BloomTargets,
) {
  const levels = createBloomLevels(device, targets)
  const setup = createBloomSetup(device, programs, targets)
  // The shares of the centre texel the two passes of each level keep (`bloomCross`).
  const cross = [0, 0]
  let glow: GPUTextureView | undefined,
    setupUsed = false
  return {
    /** The glow the last `encode` drew: the finest level's blur, none when nothing drew. */
    get view() {
      return glow
    },
    /** Whether the last `encode` drew a setup, and so the chain under it. */
    get usedSetup() {
      return setupUsed
    },
    /** Forgets what the last `encode` drew: a bloom that draws no Gaussian glow this image. */
    reset() {
      glow = undefined
      setupUsed = false
    },
    /** Draws the glow of `bloom` as `settings` ask, over the scene's chain `post` shares; returns the
     *  render passes drawn, 0 where the quality or every level leaves it out. */
    encode(encoder: GPUCommandEncoder, bloom: Bloom, post: PostFrame, settings: BloomValues) {
      glow = undefined
      setupUsed = false
      const first = firstLevelOf(settings.bloomQuality)
      const finest = finestLevel(bloom.levels, first)
      if (finest < 0) return 0
      const local = post.local && settings.bloomApplyLocalExposure
      const withSetup = bloom.threshold > -1 || local
      const { scene } = post
      scene.need(withSetup ? 1 : BLOOM_LEVEL_COUNT)
      let drawn = 0,
        image = scene.view(0)!
      if (withSetup) {
        image = setup.encode(encoder, bloom, post, local)
        drawn = BLOOM_LEVEL_COUNT // the setup, and the five levels under it
        setupUsed = true
      }
      cross[0] = Math.max(settings.bloomCross, 0)
      cross[1] = Math.abs(settings.bloomCross)
      drawn += levels.draw(encoder, bloom, withSetup ? targets.chain : scene, image, first, cross)
      glow = levels.view(finest)
      return drawn
    },
    dispose() {
      setup.release()
      glow = undefined
      levels.dispose()
    },
  }
}
