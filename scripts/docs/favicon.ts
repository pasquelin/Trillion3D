/**
 * The site's `/favicon.ico`, which a browser asks of the root for every page that links no icon of
 * its own: every example, each of which would otherwise log a 404 on its console. It is the
 * portal's icon (`site/index.html`), a teal card with two dark lines on a 16-pixel grid, written
 * here pixel by pixel as an uncompressed 32-bit icon: one image, no source file to keep in step.
 */
const SIZE = 16;
/** The icon's rectangles, painted in order: x, y, width, height, then red, green, blue. */
const SHAPES = [
  [2, 3, 12, 10, 0x14, 0xb8, 0xa6],
  [4, 5, 8, 2, 0x07, 0x11, 0x1f],
  [4, 9, 5, 2, 0x07, 0x11, 0x1f],
] as const;

/** The bytes of `favicon.ico`: its header, its one directory entry, then a bitmap of its pixels
 *  (rows bottom-up, blue first) followed by the empty mask its alpha makes redundant. */
export function favicon(): Buffer {
  const pixels = Buffer.alloc(SIZE * SIZE * 4),
    mask = Buffer.alloc(4 * SIZE); // a bit per pixel, each row of 16 padded to 4 bytes
  for (const [x0, y0, width, height, red, green, blue] of SHAPES)
    for (let y = y0; y < y0 + height; y++)
      for (let x = x0; x < x0 + width; x++)
        pixels.set([blue, green, red, 0xff], ((SIZE - 1 - y) * SIZE + x) * 4);
  const bitmap = Buffer.alloc(40 + pixels.length + mask.length);
  bitmap.writeUInt32LE(40, 0); // the header's own size
  bitmap.writeInt32LE(SIZE, 4);
  bitmap.writeInt32LE(SIZE * 2, 8); // an icon counts its mask's rows with its pixels'
  bitmap.writeUInt16LE(1, 12); // planes
  bitmap.writeUInt16LE(32, 14); // bits per pixel
  bitmap.writeUInt32LE(pixels.length + mask.length, 20);
  pixels.copy(bitmap, 40);
  const head = Buffer.alloc(6 + 16);
  head.writeUInt16LE(1, 2); // an icon
  head.writeUInt16LE(1, 4); // one image
  head.writeUInt8(SIZE, 6);
  head.writeUInt8(SIZE, 7);
  head.writeUInt16LE(1, 10); // planes
  head.writeUInt16LE(32, 12); // bits per pixel
  head.writeUInt32LE(bitmap.length, 14);
  head.writeUInt32LE(head.length, 18); // where the bitmap starts
  return Buffer.concat([head, bitmap]);
}
