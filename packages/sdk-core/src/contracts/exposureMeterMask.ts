import { refusal } from './nameMatch.ts'
import { resolveHostImage, type HostImage } from './hostImage.ts'

/**
 * The automatic exposure's metering mask: a picture that says where in the image the exposure
 * looks. Each pixel of the measure counts as much as the mask's red channel at its place in the
 * image — read as plain numbers, bilinearly, 0 to 1 —, so a bright spot of the mask weighs the
 * exposure and a dark one leaves it out. The basic method reads it once a texel of its grid, no
 * lower than 0.05 (`exposureMethod`, `exposureOptions.ts`). None by default: every pixel counts
 * the same, and nothing is held for it.
 */

/** A picture a host gives the metering mask (`HostImage`). */
export type ExposureMeterMaskImage = HostImage

/** The option a session or a world takes for the metering mask, beside the exposure's settings
 *  (`exposureOptions.ts`): `exposureMeterMask`, none by default. */
export interface ExposureMeterMaskOptions {
  exposureMeterMask?: ExposureMeterMaskImage | null
}

/** The picture an option names: `image` when it is one with a width and a height, none (`undefined`)
 *  when the option is absent or `null`.
 *  @throws TypeError naming what the option takes when it is anything else. */
export const resolveExposureMeterMask = (image: ExposureMeterMaskImage | null | undefined) =>
  resolveHostImage(image, refusal('exposureMeterMask'), 'the mask')
