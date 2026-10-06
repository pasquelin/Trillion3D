// PNG decoding for the bench's images: 8-bit grey, grey with alpha, RGB, palette (with its
// transparency) and RGBA, not interlaced — what the examples' textures and `sips` write. The
// repository's own reader (`sdk-node/src/cutout/png.mts`) takes 8-bit RGBA only.
import { inflateSync } from 'node:zlib'

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }

/** The Paeth predictor of the PNG filters. */
function paeth(a: number, b: number, c: number) {
  const p = a + b - c,
    pa = Math.abs(p - a),
    pb = Math.abs(p - b),
    pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

/** `png` decoded to RGBA rows, top row first; throws on a PNG it does not read. */
export function readPng(png: Uint8Array) {
  const view = Buffer.from(png.buffer, png.byteOffset, png.byteLength)
  let width = 0,
    height = 0,
    type = 0,
    palette: Buffer | null = null,
    alphas: Buffer | null = null
  const data: Buffer[] = []
  for (let at = 8; at < view.length;) {
    const length = view.readUInt32BE(at),
      kind = view.toString('ascii', at + 4, at + 8),
      body = view.subarray(at + 8, at + 8 + length)
    if (kind === 'IHDR') {
      ;[width, height] = [body.readUInt32BE(0), body.readUInt32BE(4)]
      type = body[9]
      if (body[8] !== 8 || body[12] !== 0 || !(type in CHANNELS))
        throw new Error(`BENCH_PNG: depth ${body[8]}, type ${type}, interlace ${body[12]} not read`)
    } else if (kind === 'PLTE') palette = body
    else if (kind === 'tRNS') alphas = body
    else if (kind === 'IDAT') data.push(body)
    else if (kind === 'IEND') break
    at += 12 + length
  }
  const channels = CHANNELS[type],
    stride = width * channels,
    raw = inflateSync(Buffer.concat(data)),
    rows = new Uint8Array(stride * height)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)],
      line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? rows[y * stride + x - channels] : 0,
        up = y ? rows[(y - 1) * stride + x] : 0,
        corner = y && x >= channels ? rows[(y - 1) * stride + x - channels] : 0
      const predicted = [0, left, up, (left + up) >> 1, paeth(left, up, corner)][filter]
      rows[y * stride + x] = (line[x] + predicted) & 255
    }
  }
  const rgba = new Uint8Array(width * height * 4)
  const pixels = width * height
  // One loop per colour type, each writing straight into the RGBA rows.
  if (type === 6) rgba.set(rows)
  else if (type === 2)
    for (let i = 0; i < pixels; i++) {
      rgba[i * 4] = rows[i * 3]
      rgba[i * 4 + 1] = rows[i * 3 + 1]
      rgba[i * 4 + 2] = rows[i * 3 + 2]
      rgba[i * 4 + 3] = 255
    }
  else if (type === 3)
    for (let i = 0; i < pixels; i++) {
      const at = rows[i]
      rgba[i * 4] = palette![at * 3]
      rgba[i * 4 + 1] = palette![at * 3 + 1]
      rgba[i * 4 + 2] = palette![at * 3 + 2]
      rgba[i * 4 + 3] = alphas?.[at] ?? 255
    }
  else
    for (let i = 0; i < pixels; i++) {
      const grey = rows[i * channels]
      rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = grey
      rgba[i * 4 + 3] = type === 4 ? rows[i * 2 + 1] : 255
    }
  return { width, height, rgba }
}
