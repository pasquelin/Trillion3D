import { deflateSync } from 'node:zlib';

/**
 * A PNG writer, in the few lines PNG actually needs: a header, one deflated image block, an end.
 *
 * Two callers want it — the terminals whose inline-image protocol takes a file format rather than
 * raw texels, and the link the question offers to open the picture in the system's own viewer. Node
 * carries the compression and the rest is bookkeeping, so this stays cheaper than a dependency.
 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let at = 0; at < 256; at++) {
    let value = at;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[at] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(kind: string, body: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(kind, 4, 'ascii');
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, tail]);
}

/** Straight RGBA8 to PNG bytes, one filter byte per row and no interlacing. */
export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const from = y * width * 4;
    raw[y * (1 + width * 4)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + from, width * 4).copy(raw, y * (1 + width * 4) + 1);
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
