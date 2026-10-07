import test from 'node:test'
import assert from 'node:assert/strict'
import { fromHalf, toHalf } from '../../../math/src/float/half.ts'
import { LTC_SIZE, encodeLtcTable, ltcTable } from './ltcTable.ts'

/** The halves `encodeLtcTable` wrote: base64 of little-endian sixteen-bit words. */
const encodedHalves = (text: string) => {
  const bytes = Uint8Array.from(atob(text), (char) => char.charCodeAt(0))
  assert.equal(bytes.length % 2, 0, 'two bytes a half')
  const view = new DataView(bytes.buffer)
  return Array.from({ length: bytes.length / 2 }, (_, i) => fromHalf(view.getUint16(i * 2, true)))
}

test('the table is decoded once into the cells the GPU reads', () => {
  const table = ltcTable()
  assert.equal(ltcTable(), table)
  assert.ok(Number.isInteger(table.length / LTC_SIZE ** 2))
  assert.ok(table.length / LTC_SIZE ** 2 >= 6)
})

test('every cell holds an orientation-preserving transform, a magnitude and a share, then zeros', () => {
  const table = ltcTable(),
    floats = table.length / LTC_SIZE ** 2
  const wrong: number[] = []
  for (let cell = 0; cell < LTC_SIZE ** 2; cell++) {
    const [xx, xz, zx, zz, magnitude, share, ...padding] = table.slice(
      cell * floats,
      (cell + 1) * floats,
    )
    if (
      !(xx > 0) ||
      !(xx * zz - xz * zx > 0) ||
      !(magnitude > 0 && magnitude <= 1) ||
      !(share >= 0 && share <= 1) ||
      padding.some((value) => value !== 0)
    )
      wrong.push(cell)
  }
  assert.deepEqual(wrong, [])
})

test('encoding keeps the six values of each cell, which decode back to the same table', () => {
  const table = ltcTable(),
    floats = table.length / LTC_SIZE ** 2
  const kept = [...table].filter((_, i) => i % floats < 6)
  assert.deepEqual(encodedHalves(encodeLtcTable(table)), kept)
  const padded = table.slice()
  for (let cell = 0; cell < LTC_SIZE ** 2; cell++)
    padded.fill(cell + 1, cell * floats + 6, (cell + 1) * floats)
  assert.equal(encodeLtcTable(padded), encodeLtcTable(table))
})

test('encoding rounds each kept value to its nearest half', () => {
  const cell = [1.0006, -2.5, 3e-6, 70000, 0.333, -0.1, 7, 8]
  assert.deepEqual(
    encodedHalves(encodeLtcTable(Float32Array.from([...cell, ...cell.map((v) => -v)]))),
    [...cell.slice(0, 6), ...cell.slice(0, 6).map((v) => -v)].map((v) => fromHalf(toHalf(v))),
  )
})
