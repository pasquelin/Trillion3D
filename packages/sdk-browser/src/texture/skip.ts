import { previewIsWhole, type ClusterManifest } from '../../../sdk-core/src/index.ts';

/**
 * A 1×1 opaque white PNG: what the prepared scene decodes in place of an image whose mip
 * chain is baked in the cache. The host texture still exists — it is what the texture ranks
 * name, and what the atlas stores — but its image weighs nothing, and the source megabytes
 * cross neither the network nor the browser decoder.
 */
export const PLACEHOLDER_IMAGE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP4DwQACfsD/Wj6HMwAAAAASUVORK5CYII=';

/**
 * Addresses of images the loader can skip reading: those whose every sidecar entry carries
 * a whole chain — everything past the tail is baked — and that have at least one. An image
 * with no entry failed compiler decode, and an image whose one entry is not whole still needs
 * its source: those two are read as before.
 *
 * `resolve` writes the address as the reader of the prepared scene will fetch it
 * (`../host/prepared/images.ts`): the skip set and the fetch compare one string, so an image
 * is never read because the two spelled its address differently.
 */
export function bakedImageUrls(
  metadata: ClusterManifest,
  images: ReadonlyArray<{ uri: string | null }> | undefined,
  resolve: (uri: string) => string,
): Set<string> {
  const whole = new Map<number, boolean>();
  for (const preview of metadata.texturePreviews ?? []) {
    whole.set(preview.image, (whole.get(preview.image) ?? true) && previewIsWhole(preview));
  }
  const urls = new Set<string>();
  if (!metadata.textures || !images) return urls;
  for (const [image, complete] of whole) {
    const uri = images[image]?.uri;
    if (complete && uri && !uri.startsWith('data:')) urls.add(resolve(uri));
  }
  return urls;
}
