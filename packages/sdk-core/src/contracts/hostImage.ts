import { isImageSize } from '../../../math/src/scalar/integers.ts'
import { type Refuse } from './nameMatch.ts'

/** A picture a host gives the engine: an `ImageBitmap`, as `loader.imageBitmap` decodes one;
 *  anything with a width and a height the engine can copy to a texture. */
export interface HostImage {
  readonly width: number
  readonly height: number
}

/**
 * The picture an option names: `image` when it is one — a whole width and a whole height, each of at
 * least 1 —, none (`undefined`) when the option is absent or `null`.
 * @throws TypeError, through `refuse`, saying `what` must be an image with a width and a height when
 *   it is anything else.
 */
export function resolveHostImage<T extends HostImage>(
  image: T | null | undefined,
  refuse: Refuse,
  what: string,
): T | undefined {
  if (image === undefined || image === null) return undefined
  const { width, height } = image as Partial<HostImage>
  if (!isImageSize(width!, height!))
    return refuse(`${what} must be an image with a width and a height`)
  return image
}
