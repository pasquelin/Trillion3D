// `copyExternalImageToTexture` for the bench's decoded images (`images.ts`): Dawn in Node copies no
// browser image, so a bench bitmap's region is written with `writeTexture` — straight from the
// bitmap's own rows when it is taken as it is, which a browser's copy costs the CPU nothing either,
// else from its rows flipped, premultiplied or swapped once per bitmap.
import { BenchBitmap, shapedPixels } from './images.ts';

const pair = (origin: GPUOrigin2D | undefined): [number, number] =>
  Array.isArray(origin)
    ? [origin[0] ?? 0, origin[1] ?? 0]
    : [(origin as GPUOrigin2DDict)?.x ?? 0, (origin as GPUOrigin2DDict)?.y ?? 0];

/** Patches `queue`'s prototype: a bench bitmap goes through `writeTexture`, anything else to Dawn. */
export function writeBitmap(queue: GPUQueue) {
  const original = queue.copyExternalImageToTexture;
  queue.copyExternalImageToTexture = function (this: GPUQueue, source, destination, size) {
    if (!(source.source instanceof BenchBitmap))
      return original.call(this, source, destination, size);
    const bitmap = source.source;
    const extent = size as GPUExtent3DDict;
    const [width, height = 1] = Array.isArray(size) ? size : [extent.width, extent.height ?? 1];
    const format = destination.texture.format;
    if (!/^(rgba|bgra)8unorm(-srgb)?$/.test(format))
      throw new Error(`BENCH_IMAGE_COPY: an image into ${format} is not handled`);
    const pixels = shapedPixels(
      bitmap,
      source.flipY === true,
      destination.premultipliedAlpha === true,
      format.startsWith('bgra'),
    );
    const [x, y] = pair(source.origin);
    // The region is read in place: its first texel's offset, the bitmap's own row pitch. `origin`
    // names the region in the image as it is; flipped, its rows lie mirrored, its last row first.
    const top = source.flipY === true ? bitmap.height - y - height : y;
    this.writeTexture(
      destination,
      pixels as Uint8Array<ArrayBuffer>,
      { offset: (top * bitmap.width + x) * 4, bytesPerRow: bitmap.width * 4, rowsPerImage: height },
      [width, height, 1],
    );
  };
}
