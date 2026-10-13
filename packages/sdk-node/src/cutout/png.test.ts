import assert from 'node:assert/strict'
import { test } from 'node:test'
import { deflateSync } from 'node:zlib'
import { decodePng, encodePng } from './png.mts'

/** A PNG chunk of `kind`, its CRC left out: the reader does not check it. */
function chunk(kind: string, body: Buffer) {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(body.length, 0)
  head.write(kind, 4, 'ascii')
  return Buffer.concat([head, body, Buffer.alloc(4)])
}

/** A PNG of `type` from raw filtered rows, its `extra` chunks before the data. */
function png(width: number, height: number, type: number, rows: number[], extra: Buffer[] = []) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([8, type, 0, 0, 0], 8)
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    ...extra,
    chunk('IDAT', deflateSync(Buffer.from(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

test('an RGBA PNG reads back the pixels written', () => {
  const rgba = Uint8Array.from([1, 2, 3, 4, 250, 251, 252, 253, 9, 8, 7, 6, 0, 0, 0, 255])
  assert.deepEqual(decodePng(encodePng(2, 2, rgba)).rgba, rgba)
})

test('an RGB PNG with the Sub and Up filters reads as opaque RGBA', () => {
  // Row 0, Sub: (10,20,30) then +5 each → (15,25,35). Row 1, Up: +1 on each byte of row 0.
  const file = png(2, 2, 2, [1, 10, 20, 30, 5, 5, 5, 2, 1, 1, 1, 1, 1, 1])
  assert.deepEqual(
    [...decodePng(file).rgba],
    [10, 20, 30, 255, 15, 25, 35, 255, 11, 21, 31, 255, 16, 26, 36, 255],
  )
})

test('a palette PNG reads its colours and their transparency', () => {
  const palette = Buffer.from([255, 0, 0, 0, 0, 255])
  const file = png(2, 1, 3, [0, 1, 0], [chunk('PLTE', palette), chunk('tRNS', Buffer.from([128]))])
  assert.deepEqual([...decodePng(file).rgba], [0, 0, 255, 255, 255, 0, 0, 128])
})

test('a grey PNG with alpha reads its grey on the three colours, the Average filter undone', () => {
  // Row 0, None: (40, 200), (60, 100). Row 1, Average: each byte + floor((left + up) / 2).
  const file = png(2, 2, 4, [0, 40, 200, 60, 100, 3, 0, 0, 0, 0])
  assert.deepEqual(
    [...decodePng(file).rgba],
    [40, 40, 40, 200, 60, 60, 60, 100, 20, 20, 20, 100, 40, 40, 40, 100],
  )
})
