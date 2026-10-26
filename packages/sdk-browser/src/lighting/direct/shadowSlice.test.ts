import test from 'node:test'
import assert from 'node:assert/strict'
import { shadowSliceOf } from './shadowSlice.ts'

// The slice of a shadowed light carries its record's rank and two flags, and is never the −1 of no shadow.
test('the slice names the record, the sun and the single page, and is never negative', () => {
  const seen = new Set<number>()
  for (const record of [0, 1, 63, 64, 1000])
    for (const sun of [false, true])
      for (const distant of [false, true]) {
        const slice = shadowSliceOf(record, sun, distant)
        assert.ok(slice >= 0)
        assert.equal(slice >> 2, record)
        assert.equal((slice & 2) !== 0, sun)
        assert.equal((slice & 1) !== 0, distant)
        assert.ok(!seen.has(slice), 'distinct')
        seen.add(slice)
      }
})
