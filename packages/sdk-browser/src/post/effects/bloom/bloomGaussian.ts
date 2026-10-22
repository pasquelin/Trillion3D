import type { Bloom } from '../../../../../sdk-core/src/world/effect/bloom.ts'
import { BLOOM_LEVEL_COUNT } from '../../../../../sdk-core/src/contracts/bloomOptions.ts'
import {
  BLOOM_QUALITY_STAGES,
  type BloomQualityLevel,
} from '../../../../../sdk-core/src/contracts/bloomRules.ts'
import {
  GAUSSIAN_BLUR_RULES,
  type GaussianBlurValues,
} from '../../../../../sdk-core/src/contracts/gaussianBlurRules.ts'
import { resolveSettings } from '../../../../../sdk-core/src/contracts/settingRules.ts'
import type { PostFrame } from '../../finish/finish.ts'
import type { ValuesOf } from '../kindRules.ts'
import type { createBloomPrograms } from './bloomPrograms.ts'
import { createBloomLevels, finestLevel, type BlurLook } from './bloomLevels.ts'
import { createBloomSetup } from './bloomSetup.ts'
import type { BloomTargets } from './bloomTargets.ts'

type BloomPrograms = Awaited<ReturnType<typeof createBloomPrograms>>

/** The widest levels the quality keeps (`BLOOM_QUALITY_STAGES`): the first of the six that draws.
 *  The quality `'off'` draws no bloom of either method: no pass of it is handed to the kind
 *  (`KIND_RULES.bloom.off`), so it never asks. */
const firstLevelOf = (quality: BloomQualityLevel) =>
  BLOOM_LEVEL_COUNT - BLOOM_QUALITY_STAGES[quality as Exclude<BloomQualityLevel, 'off'>]

/** The blur settings of a bloom drawn before any frame names them: the defaults. */
const NO_BLUR: GaussianBlurValues = resolveSettings(GAUSSIAN_BLUR_RULES, {})

/** What the levels are blurred with under `settings`, written into `look`: the first level that
 *  draws, the shares of the centre texel the two passes keep (`bloomCross`: both above 0, the
 *  vertical alone below) and the settings that size the blur; returns the first level. */
function writeBlur(
  look: { first: number; cross: number[]; blur: GaussianBlurValues },
  settings: ValuesOf<'bloom'>,
) {
  look.cross[0] = Math.max(settings.bloomCross, 0)
  look.cross[1] = Math.abs(settings.bloomCross)
  look.blur = settings
  return (look.first = firstLevelOf(settings.bloomQuality))
}

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
  // What the levels are blurred with, rewritten by each image (`writeBlur`).
  const blur: BlurLook = { first: 0, cross: [0, 0], blur: NO_BLUR }
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
    /** Forgets what the last `encode` drew: called before each image, by a bloom that may draw no
     *  Gaussian glow this image. */
    reset() {
      glow = undefined
      setupUsed = false
    },
    /** Draws the glow of `bloom` as `settings` ask, over the scene's chain `post` shares; returns the
     *  render passes drawn, 0 where every level is left out. */
    encode(encoder: GPUCommandEncoder, bloom: Bloom, post: PostFrame, settings: ValuesOf<'bloom'>) {
      const finest = finestLevel(bloom.levels, writeBlur(blur, settings))
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
      drawn += levels.draw(encoder, bloom, withSetup ? targets.chain : scene, image, blur)
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
