import test from 'node:test'
import assert from 'node:assert/strict'
import { createViewFilter } from './viewFilter.ts'

// The roots a view does not draw whatever its lists say (`forced`): an object hidden from the view that owns
// it, one that casts while hidden. They make a filter of a view that lists nothing.
test('forced roots are bits of the filter, though the view lists nothing', () => {
  const filter = createViewFilter()
  const under = () => 0
  assert.equal(filter.update(undefined, 70, under, 1), undefined, 'nothing listed, nothing forced')
  const forced = [3, 35, 69]
  const bits = filter.update(undefined, 70, under, 1, forced)!
  assert.ok(bits)
  for (const rank of [3, 35, 69]) assert.ok((bits[rank >> 5] >>> (rank % 32)) & 1, `${rank}`)
  assert.equal(
    bits.reduce((n, word) => n + (word.toString(2).match(/1/g)?.length ?? 0), 0),
    3,
  )
  assert.equal(
    filter.update(undefined, 70, under, 1, forced),
    bits,
    'the same array until the scene moves',
  )
  assert.notEqual(filter.update(undefined, 70, under, 1, [3]), bits, 'a new list of roots')
})

// The roots the view's occlusion test found hidden are not drawn, but the bits the shadows follow (`base`) are the same.
test('occluded roots are bits of the filter, not of its base', () => {
  const filter = createViewFilter()
  const under = () => 0
  const bits = filter.update(undefined, 70, under, 1, [3], [35, 69])!
  const base = filter.base()!
  assert.equal(base.length, bits.length)
  for (const rank of [3, 35, 69]) assert.ok((bits[rank >> 5] >>> (rank % 32)) & 1, `${rank}`)
  assert.ok((base[0] >>> 3) & 1)
  assert.equal(base[1] >>> 3, 0, 'rank 35 is not in the base')
  const again = filter.update(undefined, 70, under, 1, [3], [69])!
  assert.notEqual(again, bits)
  assert.equal(filter.base(), base, 'the base did not move with the occlusion')
  assert.equal(filter.update(undefined, 70, under, 1, undefined, undefined), undefined)
  assert.equal(filter.base(), undefined)
})
