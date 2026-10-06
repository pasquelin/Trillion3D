import { EngineError, type TexturePreview } from '../contracts/index.ts'
import * as format from './binaryFormat.ts'
import { levelBlockBytes, type previewGeometry } from '../texture/previewLevels.ts'

// The rules of one texture-preview entry that the reader (`binaryPreview.ts`) and the writer share.

/** Byte length of each carried level in the pixel column and in a block column, tail order. */
export function levelLengths(geometry: ReturnType<typeof previewGeometry>) {
  return {
    rgba: geometry.sizes.map(([w, h]) => w * h * 4),
    blocks: geometry.sizes.map(([w, h]) => levelBlockBytes(w, h)),
  }
}

/** What both write and read require of an entry — integer (texture, atlas) pair
 *  strictly increasing, known atlas, real source dimensions, baked levels under the tail —
 *  so an entry rejected on write is exactly the one read would reject. Returns the
 *  entry key, which the next one must exceed. */
export function checkEntryHeader(
  entry: number,
  header: Pick<TexturePreview, 'texture' | 'atlas' | 'width' | 'height' | 'bakedLevels'>,
  previous: number,
  firstLevel: number,
) {
  const { texture, atlas, width, height, bakedLevels } = header
  if (format.previewAtlasName(atlas) === undefined)
    throw new EngineError('INVALID_CACHE', 'A texture preview names an unknown atlas', {
      entry,
      atlas,
    })
  // Keyed by the atlas that samples the chain: one colour entry per texture, plain or coverage.
  const key = texture * 2 + format.previewAtlasOf(atlas)
  if (!Number.isInteger(texture) || key <= previous)
    throw new EngineError(
      'INVALID_CACHE',
      'Texture previews are not ordered by texture and atlas',
      {
        entry,
        texture,
        atlas,
      },
    )
  if (!(width > 0) || !(height > 0))
    throw new EngineError('INVALID_CACHE', 'A texture preview declares an empty source image', {
      entry,
      width,
      height,
    })
  if (!Number.isInteger(bakedLevels) || bakedLevels < 0 || bakedLevels > firstLevel)
    throw new EngineError(
      'INVALID_CACHE',
      'A texture preview bakes more levels than lie above its tail',
      {
        entry,
        bakedLevels,
      },
    )
  return key
}
