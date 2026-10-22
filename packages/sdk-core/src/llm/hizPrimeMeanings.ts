import type { HizField } from '../contracts/hizOptions.ts'

/** The settings of the depth pyramid that govern the primed pyramid. */
export type HizPrimeField = Extract<
  HizField,
  | 'hizPrime'
  | 'hizPrimeSizeBias'
  | 'hizPrimeDepthBias'
  | 'hizPrimeErrorScale'
  | 'hizPrimeFarFieldOnly'
>

/** What each of them means (`../contracts/hizOptions.ts`). */
export const HIZ_PRIME_MEANINGS: Readonly<Record<HizPrimeField, string>> = {
  hizPrime:
    "When a view builds a primed depth pyramid before its cut's main pass, from a small, coarse draw of its objects, for the main pass to test against: 'off', the default, never; 'whenMissing', for an image whose view has no pyramid of the image before — its first, one after a resize, one after a cut of the camera —; 'always', for every image. The main pass tests against the previous image's pyramid when the view has one; the primed one stands for it otherwise, and is never kept for the next image.",
  hizPrimeSizeBias:
    "How much smaller than the image the primed draw is: its width and height are the image's shifted right by one more than this, 2 by default, so an eighth of the image's, never under one pixel. From 0 to 8.",
  hizPrimeDepthBias:
    "Metres the primed depth is pushed away from the eye by before it is reduced into the pyramid, 1.5 by default: the coarse draw is then never in front of the image's own surfaces, so what the pyramid hides stays hidden in the image.",
  hizPrimeErrorScale:
    "The factor on the cut's pixel error for the primed draw, 32 by default: the clusters drawn are that much coarser than the image's own. A finite number above zero.",
  hizPrimeFarFieldOnly:
    'Whether the primed draw holds the objects that set farField alone (true, the default), or every object of the view. With none flagged, a primed draw of the flagged objects is empty and costs nothing.',
}
