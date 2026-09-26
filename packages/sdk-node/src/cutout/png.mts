import { crc32, deflateSync, inflateSync } from 'node:zlib';

/** One PNG chunk: length, type, payload, and the CRC that `node:zlib` already knows how to compute. */
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
    // `flipY`: texels of bottom-left origin, as a GPU read yields them.
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

/** A PNG row filter's prediction from the texel on the left, above, and above-left. */
function predict(filter: number, left: number, up: number, corner: number) {
  const p = left + up - corner;
  const [a, b, c] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - corner)];
  const paeth = a <= b && a <= c ? left : b <= c ? up : corner;
  const all = [0, left, up, (left + up) >> 1, paeth];
  if (all[filter] === undefined) throw new Error(`PNG filter ${filter} does not exist`);
  return all[filter];
}

/** The reader of what the compiler writes for a baked level: straight RGBA8, no interlacing, the
 *  five row filters. Any other PNG is refused rather than misread. */
export function decodePng(png: Uint8Array) {
  const bytes = Buffer.from(png.buffer, png.byteOffset, png.byteLength);
  const data: Buffer[] = [];
  let [width, height, at] = [0, 0, 8];
  while (at + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(at);
    const body = bytes.subarray(at + 8, at + 8 + length);
    const kind = bytes.toString('ascii', at + 4, at + 8);
    if (kind === 'IHDR') {
      [width, height] = [body.readUInt32BE(0), body.readUInt32BE(4)];
      if (body[8] !== 8 || body[9] !== 6 || body[12] !== 0)
        throw new Error('decodePng reads 8-bit RGBA without interlacing only');
    } else if (kind === 'IDAT') data.push(body);
    at += length + 12;
  }
  const raw = inflateSync(Buffer.concat(data));
  const stride = width * 4;
  const rgba = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const [filter, from, row] = [raw[y * (stride + 1)] ?? 0, y * (stride + 1) + 1, y * stride];
    for (let x = 0; x < stride; x++) {
      const left = x >= 4 ? (rgba[row + x - 4] ?? 0) : 0;
      const up = y > 0 ? (rgba[row - stride + x] ?? 0) : 0;
      const corner = x >= 4 && y > 0 ? (rgba[row - stride + x - 4] ?? 0) : 0;
      rgba[row + x] = ((raw[from + x] ?? 0) + predict(filter, left, up, corner)) & 0xff;
    }
  }
  return { width, height, rgba };
}
