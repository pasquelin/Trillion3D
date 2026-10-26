import { refusal } from './nameMatch.ts'
import { resolveHostImage, type HostImage } from './hostImage.ts'
import { resolveTint, type BloomTint } from './bloomFields.ts'
import {
  nonNegativeSetting as nonNegative,
  resolveSettings,
  rulesOf,
  type SettingOptions,
  type SettingValues,
} from './settingRules.ts'

/**
 * The dirt mask of the bloom's glow, whichever method makes it (`./bloomOptions.ts`): a picture of
 * the smudges and dust on a lens, which show only where light spills over them. Each pixel of the
 * glow is multiplied by `1 + mask × tint × intensity / the bloom's intensity` — the mask read at
 * the pixel's place in the image, filtered, its colour read as a display picture is (sRGB) —, so a
 * pixel with no glow shows no dirt, and a brighter glow shows more of it. Off by default: with no
 * image, or an intensity of 0, the glow is left as it is and nothing is drawn.
 */

/** A picture a host gives the dirt mask (`HostImage`). */
export type BloomDirtImage = HostImage

/** The dirt mask's scalar settings: its strength, 0 or more, 0 the reference's default — no dirt,
 *  and the dirt added to the glow is linear in it. */
const BLOOM_DIRT_RULES = /* @__PURE__ */ (() => rulesOf([nonNegative('intensity', 0)] as const))()

/** What a page may pass to `effect.bloom({ dirtMask })`. */
export interface BloomDirtMaskOptions extends SettingOptions<typeof BLOOM_DIRT_RULES> {
  /** The picture; none leaves the glow without dirt. */
  image?: BloomDirtImage | null
  /** The colour of the dirt, per channel: a grey 0.5 by default, which the intensity then scales. */
  tint?: BloomTint
}

/** The dirt mask as the engine reads it: every field set. */
export interface ResolvedBloomDirtMask extends SettingValues<typeof BLOOM_DIRT_RULES> {
  readonly image: BloomDirtImage | undefined
  readonly tint: readonly [number, number, number]
}

/** The colour of the dirt the reference starts with: a grey 0.5. */
const DEFAULT_TINT = Object.freeze([0.5, 0.5, 0.5] as const)

/**
 * The dirt mask an option names: every field it leaves out is the default (`BLOOM_DIRT_RULES`, the
 * tint's grey).
 * @throws TypeError naming the field and what it takes when the intensity is out of its range or
 *   the image is not a picture; RangeError naming the tint when it is not three numbers of at least 0.
 */
export function resolveBloomDirtMask(options: BloomDirtMaskOptions = {}): ResolvedBloomDirtMask {
  const { image, tint, ...scalars } = options
  return Object.freeze({
    ...resolveSettings(BLOOM_DIRT_RULES, scalars),
    image: resolveHostImage(image, refusal('bloom'), 'dirtMask.image'),
    tint: resolveTint(tint, DEFAULT_TINT, 'BLOOM_DIRT_TINT'),
  })
}
