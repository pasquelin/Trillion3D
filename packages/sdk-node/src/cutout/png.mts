import { crc32, deflateSync, inflateSync } from 'node:zlib'
import { compilerError } from '../messages/catalogue.mts'

/** One PNG chunk: length, type, payload, and the CRC that `node:zlib` already knows how to compute. */
function chunk(kind: string, body: Uint8Array): Buffer {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(body.length, 0)
  head.write(kind, 4, 'ascii')
  const tail = Buffer.alloc(4)
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0)
  return Buffer.concat([head, body, tail])
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
  const stride = 1 + width * 4
  const raw = Buffer.alloc(height * stride)
  for (let y = 0; y < height; y++) {
    // `flipY`: texels of bottom-left origin, as a GPU read yields them.
    const row = flipY ? height - 1 - y : y
    raw[y * stride] = 0
    raw.set(rgba.subarray(row * width * 4, (row + 1) * width * 4), y * stride + 1)
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8 // bits per channel
  header[9] = 6 // truecolour with alpha
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', new Uint8Array(0)),
  ])
}

/** A PNG row filter's prediction from the byte on the left, above, and above-left. */
function predict(filter: number, left: number, up: number, corner: number) {
  const p = left + up - corner
  const [a, b, c] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - corner)]
  const paeth = a <= b && a <= c ? left : b <= c ? up : corner
  return [0, left, up, (left + up) >> 1, paeth][filter] ?? 0
}

/** The channels of each 8-bit colour type read: grey, RGB, palette index, grey with alpha, RGBA. */
const CHANNELS: Readonly<Record<number, number>> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }

/** `rows` of colour type `type` widened to RGBA8, one loop per type: grey copied to the three
 *  colours, a palette index read through `palette` and its transparency `alphas`, a missing alpha
 *  opaque. */
function widenToRgba(
  rows: Uint8Array,
  type: number,
  pixels: number,
  palette: Uint8Array | null,
  alphas: Uint8Array | null,
) {
  if (type === 6) return rows
  const rgba = new Uint8Array(pixels * 4)
  if (type === 2)
    for (let i = 0; i < pixels; i++) {
      rgba[i * 4] = rows[i * 3] ?? 0
      rgba[i * 4 + 1] = rows[i * 3 + 1] ?? 0
      rgba[i * 4 + 2] = rows[i * 3 + 2] ?? 0
      rgba[i * 4 + 3] = 255
    }
  else if (type === 3) {
    if (!palette) throw compilerError('PNG_UNSUPPORTED', 'a palette PNG without its PLTE chunk')
    for (let i = 0; i < pixels; i++) {
      const at = rows[i] ?? 0
      rgba[i * 4] = palette[at * 3] ?? 0
      rgba[i * 4 + 1] = palette[at * 3 + 1] ?? 0
      rgba[i * 4 + 2] = palette[at * 3 + 2] ?? 0
      rgba[i * 4 + 3] = alphas?.[at] ?? 255
    }
  } else {
    const channels = type === 4 ? 2 : 1
    for (let i = 0; i < pixels; i++) {
      rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = rows[i * channels] ?? 0
      rgba[i * 4 + 3] = type === 4 ? (rows[i * 2 + 1] ?? 0) : 255
    }
  }
  return rgba
}

/** A PNG decoded to RGBA8 rows, top row first: 8-bit grey, grey with alpha, RGB, palette (with its
 *  transparency) and RGBA, no interlacing, the five row filters — what the compiler writes for a
 *  baked level, the scenes' textures and `sips` write. Any other PNG is refused rather than
 *  misread. */
export function decodePng(png: Uint8Array, flipY = false) {
  const bytes = Buffer.from(png.buffer, png.byteOffset, png.byteLength)
  const data: Buffer[] = []
  let [width, height, type, at] = [0, 0, 6, 8]
  let palette: Buffer | null = null
  let alphas: Buffer | null = null
  while (at + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(at)
    const body = bytes.subarray(at + 8, at + 8 + length)
    const kind = bytes.toString('ascii', at + 4, at + 8)
    if (kind === 'IHDR') {
      ;[width, height, type] = [body.readUInt32BE(0), body.readUInt32BE(4), body[9] ?? 0]
      if (body[8] !== 8 || !(type in CHANNELS) || body[12] !== 0)
        throw compilerError(
          'PNG_UNSUPPORTED',
          `decodePng reads 8-bit, non-interlaced PNG only: depth ${body[8]}, type ${type}, interlace ${body[12]}`,
        )
    } else if (kind === 'PLTE') palette = body
    else if (kind === 'tRNS') alphas = body
    else if (kind === 'IDAT') data.push(body)
    else if (kind === 'IEND') break
    at += length + 12
  }
  const channels = CHANNELS[type] ?? 4
  const [raw, stride] = [inflateSync(Buffer.concat(data)), width * channels]
  if (bytes.readBigUInt64BE(0) !== 0x89504e470d0a1a0an || raw.length !== height * (stride + 1))
    throw compilerError(
      'PNG_UNSUPPORTED',
      'decodePng reads a whole PNG only: its signature, IHDR and every row',
    )
  const rows = new Uint8Array(height * stride)
  for (let y = 0; y < height; y++) {
    const [filter, from, row] = [raw[y * (stride + 1)] ?? 0, y * (stride + 1) + 1, y * stride]
    if (filter > 4) throw compilerError('PNG_UNSUPPORTED', `PNG filter ${filter} does not exist`)
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? (rows[row + x - channels] ?? 0) : 0
      const up = y > 0 ? (rows[row - stride + x] ?? 0) : 0
      const corner = x >= channels && y > 0 ? (rows[row - stride + x - channels] ?? 0) : 0
      rows[row + x] = ((raw[from + x] ?? 0) + predict(filter, left, up, corner)) & 0xff
    }
  }
  const rgba = widenToRgba(rows, type, width * height, palette, alphas)
  if (!flipY) return { width, height, rgba }
  // `flipY`: rows bottom first, as a GPU read yields them and `encodePng(…, true)` takes them.
  const flipped = new Uint8Array(rgba.length)
  const line = width * 4
  for (let y = 0; y < height; y++)
    flipped.set(rgba.subarray(y * line, (y + 1) * line), (height - 1 - y) * line)
  return { width, height, rgba: flipped }
}
