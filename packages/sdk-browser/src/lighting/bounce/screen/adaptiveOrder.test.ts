// The adaptive probes of a tile are listed by rank, never by the order their threads reach the list: a dispatch's threads
// finish in no fixed order, and a list in that order breaks the ties between a tile's probes differently from one image to the next.
import test from 'node:test'
import assert from 'node:assert/strict'
import { placeShader } from './placeWgsl.ts'
import { integrateShader } from './integratePassWgsl.ts'

test('the adaptive probes of a tile are written at their rank and read in rank order', () => {
  const place = placeShader([4, 2])
  assert.ok(place.includes('atomicOr(&header[tileIndex],1u<<at.rank)'), 'a bit a rank')
  assert.ok(
    place.includes('indices[tileIndex*SP_SAMPLES+at.rank]=adaptive'),
    'the probe at its rank',
  )
  assert.ok(!/atomicAdd\(&header/.test(place), 'no slot taken in arrival order')
  assert.ok(!/atomicAdd\(&counts/.test(place), 'no number taken in arrival order')
  assert.ok(place.includes('laneScan('), 'the numbers are a prefix sum over the tiles')
  assert.ok(place.includes('countOneBits(kept&((1u<<at.rank)-1u))'), 'then the kept ranks below')
  const read = integrateShader(1, 1, 1, [4, 2], false, false, 1, true)
  assert.ok(read.includes('firstTrailingBit(listed)'), 'ranks read lowest first')
  assert.ok(!read.includes('min(header[at],SP_SAMPLES)'), 'no count of arrival slots')
})

/** The numbering `adaptiveNumber` and `adaptiveWrite` make, serially: the tiles' kept ranks in the order of the tiles, then of the ranks; from `limit` up no row. */
function numbered(kept: number[], limit: number) {
  let first = 0
  return kept.map((bits) => {
    const numbers: (number | undefined)[] = []
    for (let rank = 0; rank < 32; rank++) {
      if (!(bits & (1 << rank))) continue
      const at = first + bitCount(bits & ((1 << rank) - 1))
      numbers[rank] = at < limit ? at : undefined
    }
    first += bitCount(bits)
    return numbers
  })
}
const bitCount = (bits: number) => bits.toString(2).split('1').length - 1

test('the numbers of the adaptive probes follow the tiles then the ranks, the first ones kept past the atlas', () => {
  const kept = [0b101, 0, 0b11, 0b1000]
  const result = numbered(kept, 5)
  assert.deepEqual([result[0][0], result[0][2]], [0, 1])
  assert.deepEqual([result[2][0], result[2][1]], [2, 3])
  assert.equal(result[3][3], 4)
  assert.equal(numbered(kept, 4)[3][3], undefined, 'the fifth fits no row of an atlas of four')
})
