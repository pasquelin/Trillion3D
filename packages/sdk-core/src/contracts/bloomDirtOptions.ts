import { refusal } from './nameMatch.ts'
import { finiteAtLeast, resolveTint, type BloomTint } from './bloomFields.ts'

/**
 * The dirt mask of the bloom's glow, whichever method makes it (`./bloomOptions.ts`): a picture of
 * the smudges and dust on a lens, which show only where light spills over them. Each pixel of the
 * glow is multiplied by `1 + mask × tint × intensity / the bloom's intensity` — the mask read at
 * the pixel's place in the image, filtered, its colour read as a display picture is (sRGB) —, so a
 * pixel with no glow shows no dirt, and a brighter glow shows more of it. Off by default: with no
 * image, or an intensity of 0, the glow is left as it is and nothing is drawn.
 */

/** A picture a host gives the dirt mask: an `ImageBitmap`, as `loader.imageBitmap` decodes one; anything
 *  with a width and a height the engine can copy to a texture. */
export interface BloomDirtImage {
  readonly width: number
  readonly height: number
}

/** What a page may pass to `effect.bloom({ dirtMask })`. */
export interface BloomDirtMaskOptions {
  /** The picture; none leaves the glow without dirt. */
  image?: BloomDirtImage | null
  /** The strength of the dirt, 0 or more; 0 shows none. */
  intensity?: number
  /** The colour of the dirt, per channel. */
  tint?: BloomTint
}

/** The dirt mask as the engine reads it: every field set. */
export interface ResolvedBloomDirtMask {
  readonly image: BloomDirtImage | undefined
  readonly intensity: number
  readonly tint: readonly [number, number, number]
}

/**
 * The defaults, each the reference's own: no `image`, an `intensity` of 0 — no dirt — and a grey
 * `tint` of 0.5, which the intensity then scales. Sensitivity: the dirt added to the glow is linear
 * in the intensity.
 */
const DEFAULT_DIRT_MASK: ResolvedBloomDirtMask = Object.freeze({
  image: undefined,
  intensity: 0,
  tint: Object.freeze([0.5, 0.5, 0.5] as const),
})

/** `image` when it is a picture with a width and a height, none when it is absent.
 *  @throws TypeError when it is anything else. */
function resolveImage(image: BloomDirtImage | null | undefined) {
  if (image === undefined || image === null) return undefined
  const { width, height } = image as Partial<BloomDirtImage>
  if (!Number.isInteger(width) || !Number.isInteger(height) || width! < 1 || height! < 1)
    return refusal('bloom')('dirtMask.image must be an image with a width and a height')
  return image
}

/**
 * The dirt mask an option names: every field it leaves out is the default (`DEFAULT_DIRT_MASK`).
 * @throws RangeError naming the field and the value when a number is out of its range, TypeError
 *   when the image is not a picture.
 */
export function resolveBloomDirtMask(options: BloomDirtMaskOptions = {}): ResolvedBloomDirtMask {
  const d = DEFAULT_DIRT_MASK
  return Object.freeze({
    image: resolveImage(options.image),
    intensity: finiteAtLeast(options.intensity ?? d.intensity, 0, 'BLOOM_DIRT_INTENSITY'),
    tint: resolveTint(options.tint, d.tint, 'BLOOM_DIRT_TINT'),
  })
}
