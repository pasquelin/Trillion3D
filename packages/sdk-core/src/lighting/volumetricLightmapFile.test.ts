import assert from 'node:assert/strict'
import test from 'node:test'
import { parseVolumetricLightmap, parseVolumetricLightmapCell } from './volumetricLightmapFile.ts'

const FORMATS = [1, 2, 3, 3, 3, 3, 3, 3, 3, 4]
const BYTES = [4, 4, 4, 4, 4, 4, 4, 4, 4, 1]

/** A file of one padded brick (5³ texels), an indirection volume of one texel and, from version 2,
 *  one cell of two bricks. */
function file(version: 1 | 2) {
  const words = [0x4c563354, version, 4, 0, 0, 0, 0, 0, 0, 1, 1, 1, 5, 5, 5]
  const sizes = BYTES.map((b, k) => (k === 0 ? 4 : 125 * b))
  FORMATS.forEach((f, k) => words.push(f, k === 8 ? 0 : sizes[k]))
  if (version === 2) words.push(1, 1)
  const head = new Uint8Array(new Uint32Array(words).buffer)
  const parts = [head]
  sizes.forEach(
    (size, k) => k !== 8 && parts.push(new Uint8Array(size + ((4 - (size % 4)) % 4)).fill(k + 1)),
  )
  if (version === 2) {
    const record = new Uint32Array(14)
    record.set([2, 1, 0, 2, 1000, 7])
    parts.push(new Uint8Array(record.buffer))
  }
  const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const part of parts) {
    bytes.set(part, at)
    at += part.length
  }
  return bytes
}

test('a file of the first version has all its bricks in its layers', () => {
  const data = parseVolumetricLightmap(file(1))
  assert.equal(data.cells, undefined)
  assert.equal(data.ambient.bytes.length, 500)
})

test('a file of the second version lists its cells after the layers', () => {
  const data = parseVolumetricLightmap(file(2))
  assert.equal(data.cells?.texels, 1)
  const [cell] = data.cells!.list
  assert.deepEqual(
    [cell.coordinates, cell.bricks, cell.offset, cell.bytes],
    [[2, 1, 0], 2, 1000, 7],
  )
  assert.equal(cell.sha256.length, 64)
})

test('a cell holds its bricks coordinates, then each layer brick after brick', () => {
  const count = 2
  const sky = false
  const layer = (n: number) => count * 125 * n
  const bytes = new Uint8Array(count * 12 + layer(4) * 7 + layer(1))
  new Uint32Array(bytes.buffer, 0, 6).set([1, 2, 3, 4, 5, 6])
  const cell = {
    coordinates: [0, 0, 0],
    bricks: count,
    offset: 0,
    bytes: bytes.length,
    sha256: '',
  } as const
  const read = parseVolumetricLightmapCell(bytes, cell, sky)
  assert.deepEqual([...read.positions], [1, 2, 3, 4, 5, 6])
  assert.equal(read.ambient.length, layer(4))
  assert.equal(read.coefficients.length, 6)
  assert.equal(read.directionalShadowing.length, layer(1))
  assert.throws(() => parseVolumetricLightmapCell(bytes.subarray(0, 40), cell, sky), /shorter/)
})
