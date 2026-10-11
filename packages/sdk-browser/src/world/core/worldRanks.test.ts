import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorldRanks } from './worldRanks.ts'
import type { Cut } from './worldCuts.ts'
import type { LoadedModel } from './loadedModel.ts'

const cut = () => ({}) as Cut
const model = () => ({}) as LoadedModel

test('a resource keeps the rank it was given, whatever is seated after it', () => {
  const ranks = createWorldRanks()
  const [a, b] = [cut(), cut()]
  assert.deepEqual([ranks.cut(a), ranks.cut(b), ranks.cut(a)], [0, 1, 0])
})

test('a model takes a block of ranks once, and the resources after it rank past it', () => {
  const ranks = createWorldRanks()
  const [a, late] = [cut(), cut()]
  const loaded = model()
  assert.equal(ranks.cut(a), 0)
  let read = 0
  const span = () => (read++, 5)
  assert.equal(ranks.model(loaded, span), 1)
  assert.equal(ranks.model(loaded, span), 1, 'the block is read at its first seat only')
  assert.equal(read, 1)
  assert.equal(ranks.cut(late), 6)
})
