import assert from 'node:assert/strict'
import test from 'node:test'
import { HZB_CORNERS_ENTRY, HZB_CORNERS_WGSL, HZB_PARAMS_BYTES } from './hzbCornersWgsl.ts'
import { hiddenRanks, sameRanks } from './occludedRoots.ts'

test('the corners pass is a program with its entry, and its uniform is the size the host writes', () => {
  assert.ok(HZB_CORNERS_WGSL.includes(`fn ${HZB_CORNERS_ENTRY}(`))
  assert.ok(HZB_CORNERS_WGSL.includes('struct HzbParams'))
  // four vec4 of words and floats, two of growths, a matrix.
  assert.equal(HZB_PARAMS_BYTES, 6 * 16 + 64)
})

test('the verdicts name the roots found behind the depth, in rank order', () => {
  assert.deepEqual(hiddenRanks(Uint32Array.of(0, 1, 0, 0, 1, 1), 5), [1, 4])
  assert.deepEqual(hiddenRanks(Uint32Array.of(1, 1), 0), [])
  assert.ok(sameRanks([1, 4], [1, 4]))
  assert.ok(!sameRanks([1, 4], [1]))
  assert.ok(!sameRanks([1, 4], [1, 5]))
})
