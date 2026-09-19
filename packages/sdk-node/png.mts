import { crc32, deflateSync } from 'node:zlib';

/** Un morceau PNG : longueur, type, charge, et le CRC que `node:zlib` sait déjà calculer. */
function chunk(kind: string, body: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(kind, 4, 'ascii');
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, tail]);
}

/**
 * A PNG writer, in the few lines PNG actually needs: a header, one deflated image block, an end.
 * Straight RGBA8, one filter byte per row and no interlacing.
 *
 * The terminals whose inline-image protocol takes a file format, the link that opens a picture in
 * the system's viewer and the bench's captures all want it. Node carries the compression and the
 * checksum, so this stays cheaper than a dependency.
 */
export function encodePng(width: number, height: number, rgba: Uint8Array, flipY = false): Buffer {
  const stride = 1 + width * 4;
  const raw = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    // `flipY` : des texels d'origine bas-gauche, comme une lecture de carte graphique les rend.
    const row = flipY ? height - 1 - y : y;
    raw[y * stride] = 0;
    raw.set(rgba.subarray(row * width * 4, (row + 1) * width * 4), y * stride + 1);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bits per channel
  header[9] = 6; // truecolour with alpha
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', new Uint8Array(0)),
  ]);
}
