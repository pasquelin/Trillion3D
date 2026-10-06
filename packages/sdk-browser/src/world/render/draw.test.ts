import test from 'node:test'
import assert from 'node:assert/strict'
import { pushPending } from './draw.ts'
import { referencePushPending } from '../../../../../bench/oracles/browser/streaming-lookups.ts'

// G6: missing addresses that an in-flight request will send again later accumulate in a
// `Set` (`pushPending`) instead of an array tested by `includes` on every added address.
// Oracle: the hand-deduped array from before batch G, copied into `../../../../../bench/oracles/browser/streaming-lookups.ts`.
test('an empty set receives the same addresses, in the same order, as a hand-deduped array', () => {
  const ensemble = new Set<string>()
  const tableau: string[] = []
  pushPending(ensemble, ['a', 'b', 'c'])
  referencePushPending(tableau, ['a', 'b', 'c'])
  assert.deepEqual([...ensemble], tableau)
})

test('duplicates inside one call, and between two calls, are counted only once', () => {
  const ensemble = new Set<string>()
  const tableau: string[] = []
  for (const lot of [['a', 'a', 'b'], ['b', 'c', 'a'], [], ['d']]) {
    pushPending(ensemble, lot)
    referencePushPending(tableau, lot)
  }
  assert.deepEqual([...ensemble], tableau)
  assert.deepEqual([...ensemble], ['a', 'b', 'c', 'd'])
})

test('a large number of partly redundant addresses keeps the same insertion order as the reference', () => {
  const ensemble = new Set<string>()
  const tableau: string[] = []
  const lot = Array.from({ length: 2000 }, (_, i) => `u${i % 700}`)
  pushPending(ensemble, lot)
  referencePushPending(tableau, lot)
  assert.deepEqual([...ensemble], tableau)
})
