import { previewIsWhole, type ClusterManifest } from '../sdk-core/index.ts';

/**
 * A 1×1 opaque white PNG: what the glTF loader receives in place of an image whose mip
 * chain is baked in the cache. The `THREE.Texture` object still exists — it is what the
 * association table names, and what the atlas stores — but its image weighs nothing, and the
 * source megabytes cross neither the network nor the browser decoder.
 */
export const PLACEHOLDER_IMAGE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP4DwQACfsD/Wj6HMwAAAAASUVORK5CYII=';

/**
 * Addresses of images the loader can skip reading: those whose every sidecar entry carries
 * a whole chain — everything past the tail is baked — and that have at least one. An image
 * with no entry failed compiler decode, and an image whose one entry is not whole still needs
 * its source: those two are read as before.
 *
 * `resolve` writes the address as the host loader will write it — for Three, the scene folder
 * + `uri` as-is, without normalisation — because that is the string the URL modifier
 * receives: a `./` or a character encoded differently by `new URL` would miss the
 * comparison, and the image would be read anyway. The rule comes from the host, not from here.
 */
export function bakedImageUrls(
  metadata: ClusterManifest,
  images: ReadonlyArray<{ uri?: string }> | undefined,
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
