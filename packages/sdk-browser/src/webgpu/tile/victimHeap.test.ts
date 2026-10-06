import test from 'node:test'
import assert from 'node:assert/strict'
import { TILES_PER_LAYER } from '../../texture/tiles.ts'
import { random } from '../../page/cut/cutRuleChecks.fixture.ts'
import { createVictimHeap } from './victimHeap.ts'

/** The victims as develop chose them: the eligible places sorted by last use, then index. */
const sorted = (lastUse: Uint32Array, eligible: number[]) =>
  [...eligible].sort((a, b) => lastUse[a] - lastUse[b] || a - b)

/** The heap's victims for the same places, `taken` of them first, the rest after. */
function drained(
  heap: ReturnType<typeof createVictimHeap>,
  lastUse: Uint32Array,
  eligible: number[],
) {
  heap.clear()
  for (const index of eligible) heap.add(lastUse[index], index)
  const queue = heap.order(),
    out: number[] = []
  assert.equal(queue.length, eligible.length)
  for (let index = queue.take(); index !== undefined; index = queue.take()) out.push(index)
  assert.equal(queue.length, 0)
  return out
}

test('the heap gives the victims develop sorted, in its order, image after image', () => {
  for (let seed = 1; seed <= 80; seed++) {
    const next = random(seed)
    // One layer to a pool of 64, the largest an atlas makes.
    const tiles = TILES_PER_LAYER * [1, 2, 64][seed % 3]
    const heap = createVictimHeap(tiles)
    for (let image = 0; image < 3; image++) {
      // Few distinct uses, so ties by last use are many; the extremes of a 32-bit frame count.
      const span = [1, 8, 2 ** 32][Math.floor(next() * 3)]
      const lastUse = new Uint32Array(tiles).map(() =>
        next() < 0.05 ? [0, 2 ** 32 - 1][Math.floor(next() * 2)] : Math.floor(next() * span),
      )
      const share = [0, 0.01, 0.5, 1][Math.floor(next() * 4)]
      const eligible = [...lastUse.keys()].filter(() => next() < share)
      assert.deepEqual(drained(heap, lastUse, eligible), sorted(lastUse, eligible), `seed ${seed}`)
    }
  }
})

test('an image left half taken is refilled whole by the next', () => {
  const heap = createVictimHeap(16)
  const lastUse = new Uint32Array([5, 3, 3, 9, 0, 7, 1, 1, 2, 8, 4, 6, 3, 0, 2, 5])
  const every = [...lastUse.keys()]
  heap.clear()
  for (const index of every) heap.add(lastUse[index], index)
  const first = heap.order()
  assert.deepEqual([first.take(), first.take(), first.take()], sorted(lastUse, every).slice(0, 3))
  assert.deepEqual(drained(heap, lastUse, every), sorted(lastUse, every))
  assert.equal(drained(heap, lastUse, []).length, 0, 'no victim: an empty queue')
})
