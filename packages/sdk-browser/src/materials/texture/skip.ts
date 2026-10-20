import { previewIsWhole } from '../../../../sdk-core/src/texture/previewLevels.ts'
import type { ClusterManifest } from '../../../../sdk-core/src/contracts/geometry.ts'

/**
 * Ranks of the images the loader can skip reading: those whose every sidecar entry carries a
 * whole chain — everything past the tail is baked — and that have at least one. Where the image
 * lives does not matter: an address beside the document, a `data:` address or a view of its
 * binary, the baked chain stands in for it alike. An image with no entry failed compiler decode,
 * and an image whose one entry is not whole still needs its source: those two are read.
 * `count` is how many images the document holds; an entry past it names none.
 */
export function bakedImages(metadata: ClusterManifest, count: number): Set<number> {
  const ranks = new Set<number>()
  if (!metadata.textures) return ranks
  const whole = new Map<number, boolean>()
  for (const preview of metadata.texturePreviews ?? []) {
    whole.set(preview.image, (whole.get(preview.image) ?? true) && previewIsWhole(preview))
  }
  for (const [image, complete] of whole) if (complete && image < count) ranks.add(image)
  return ranks
}
