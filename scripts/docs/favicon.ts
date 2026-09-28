import { encodePng } from '../../packages/sdk-node/src/cutout/png.mts';

/**
 * The site's one icon, `/favicon.ico`: the portal links it (`site/index.html`) and a browser asks
 * the root for it on every page that links none, every example, which would otherwise log a 404.
 * A teal card with two dark lines on a 16-pixel grid, drawn here and wrapped as a PNG icon.
 */
const SIZE = 16;
/** The icon's rectangles, painted in order: x, y, width, height, then red, green, blue. */
const SHAPES = [
  [2, 3, 12, 10, 0x14, 0xb8, 0xa6],
  [4, 5, 8, 2, 0x07, 0x11, 0x1f],
  [4, 9, 5, 2, 0x07, 0x11, 0x1f],
] as const;

/** The bytes of `favicon.ico`: its header, its one directory entry, then its image as a PNG. */
export function favicon(): Buffer {
  const rgba = new Uint8Array(SIZE * SIZE * 4);
  for (const [x0, y0, width, height, red, green, blue] of SHAPES)
    for (let y = y0; y < y0 + height; y++)
      for (let x = x0; x < x0 + width; x++) rgba.set([red, green, blue, 0xff], (y * SIZE + x) * 4);
  const image = encodePng(SIZE, SIZE, rgba);
  const head = Buffer.alloc(6 + 16);
  head.writeUInt16LE(1, 2); // an icon
  head.writeUInt16LE(1, 4); // one image
  head.writeUInt8(SIZE, 6);
  head.writeUInt8(SIZE, 7);
  head.writeUInt16LE(1, 10); // planes
  head.writeUInt16LE(32, 12); // bits per pixel
  head.writeUInt32LE(image.length, 14);
  head.writeUInt32LE(head.length, 18); // where the image starts
  return Buffer.concat([head, image]);
}
