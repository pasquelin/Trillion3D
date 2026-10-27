// The sheen lobe's table (`sheenLtc.ts`): the size, a few texels of it exactly as the half floats the published table rounds to, and the
// row a view along the normal reads.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fromHalf } from '../../../math/src/float/half.ts'
import { SHEEN_LTC_ALBEDO_ALONG_NORMAL, SHEEN_LTC_SIZE, sheenLtcHalves } from './sheenLtc.ts'

const texel = (row: number, column: number) => {
  const at = (row * SHEEN_LTC_SIZE + column) * 4
  return Array.from(sheenLtcHalves().subarray(at, at + 4), fromHalf)
}

test('the table is 32 x 32 texels of four half floats, decoded once', () => {
  assert.equal(SHEEN_LTC_SIZE, 32)
  assert.equal(sheenLtcHalves().length, 32 * 32 * 4)
  assert.equal(sheenLtcHalves(), sheenLtcHalves())
})

test('the texels read are the published table’s, rounded to half floats, exactly', () => {
  const spots: [number, number, number[]][] = [
    [0, 0, [0.01415252685546875, 0.0005998611450195312, 1.0013580322265625e-5]],
    [31, 31, [0.87939453125, 2.9981136322021484e-5, 0.341796875]],
    [15, 16, [0.484619140625, -0.052734375, 0.1767578125]],
    [31, 16, [0.580078125, 0.00013005733489990234, 0.0220794677734375]],
    [31, 0, [0, 0, 0]],
  ]
  for (const [row, column, [r, g, b]] of spots)
    assert.deepEqual(texel(row, column), [r, g, b, 0], `row ${row} column ${column}`)
})

test('the row along the normal is the albedo of the last row, one for each column', () => {
  assert.equal(SHEEN_LTC_ALBEDO_ALONG_NORMAL.length, SHEEN_LTC_SIZE)
  for (let column = 0; column < SHEEN_LTC_SIZE; column++)
    assert.equal(SHEEN_LTC_ALBEDO_ALONG_NORMAL[column], texel(SHEEN_LTC_SIZE - 1, column)[2])
  assert.equal(SHEEN_LTC_ALBEDO_ALONG_NORMAL[31], 0.341796875)
})
