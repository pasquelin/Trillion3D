// The pool's adaptive probes (`poolWgsl.ts`: `updateAdaptive`, `allocateAdaptive`), on its kernels run as JavaScript (`pool.fixture.ts`): a cell the pixels missed the interpolation of takes a probe at the
// mean offset they summed, keeps it while a pixel reads it, and gives it back with its cell; a pool that is not adaptive takes none.
import test from 'node:test'
import assert from 'node:assert/strict'
import { POOL_ADAPTIVE, POOL_SLOT } from './poolLayout.ts'
import { poolAt } from './pool.fixture.ts'

const EYE = [5, 5, 5]

/** The misses of the entry: `count` of them, each at the offset `units` (the units of the precision, `POOL_ADAPTIVE.precision`). */
const miss = (
  misses: Uint32Array,
  entries: number,
  entry: number,
  count: number,
  units: [number, number, number],
) => {
  misses[entry] = count
  for (let axis = 0; axis < 3; axis++) misses[(axis + 1) * entries + entry] = count * units[axis]
}

test('a cell whose interpolation was missed more than four times takes an adaptive probe at the mean offset of the misses, a cell short of that none', () => {
  const { pool, around, entryOf, cascades } = poolAt(EYE, 16, true)
  const cell = around(0, 0, 0, 0)
  const entry = entryOf(0, cell)
  const entries = cascades.levels.length * cascades.cells
  pool.mark(0, ...cell)
  pool.image({ rank: 1, eye: EYE, budget: 1 })
  assert.equal(pool.tally().live, 1)
  // Four misses are not enough.
  miss(pool.misses, entries, entry, POOL_ADAPTIVE.misses, [64, 64, 64])
  pool.mark(0, ...cell)
  pool.image({ rank: 2, eye: EYE, budget: 1 })
  assert.equal(pool.tally().live, 1, 'four misses take nothing')
  // Five at an offset of half a cell along x and the other way along z (the units of the precision: 64 is the centre, 128 a whole cell past it).
  miss(pool.misses, entries, entry, POOL_ADAPTIVE.misses + 1, [96, 64, 32])
  pool.mark(0, ...cell)
  pool.image({ rank: 3, eye: EYE, budget: 1 })
  assert.equal(pool.tally().live, 2, 'the cell took an adaptive probe')
  const word = pool.adaptiveProbes[entry * POOL_ADAPTIVE.probes]
  const slot = (word & 0xffff) - 1
  assert.ok(slot >= 0, 'the first rank holds it')
  const at = slot * POOL_SLOT.words
  assert.equal(pool.slots[at + POOL_SLOT.rank], 1)
  const spacing = cascades.levels[0].spacing
  const offset = [0, 1, 2].map(
    (axis) => new Float32Array(pool.slots.buffer, (at + POOL_SLOT.offset + axis) * 4, 1)[0],
  )
  assert.ok(
    Math.abs(offset[0] - spacing * 0.5) < 1e-5,
    'half a cell: 32 units of the 64 a cell is wide',
  )
  assert.ok(Math.abs(offset[1]) < 1e-5)
  assert.ok(Math.abs(offset[2] + spacing * 0.5) < 1e-5, 'the other way along z')
  assert.equal(pool.misses[entry], 0, 'the misses are taken: counted again from none')
})

test('an adaptive probe is given back with its cell, or when no pixel reads it for the frames the pool keeps probes', () => {
  const { pool, around, entryOf, cascades } = poolAt(EYE, 16, true)
  const cell = around(0, 0, 0, 0)
  const entry = entryOf(0, cell)
  const entries = cascades.levels.length * cascades.cells
  pool.mark(0, ...cell)
  pool.image({ rank: 1, eye: EYE, budget: 1, keep: 2 })
  miss(pool.misses, entries, entry, 9, [64, 64, 64])
  pool.mark(0, ...cell)
  pool.image({ rank: 2, eye: EYE, budget: 1, keep: 2 })
  assert.equal(pool.tally().live, 2)
  // The cell is read and the adaptive probe is not: it goes after the frames the pool keeps a probe nothing reads.
  for (let rank = 3; rank < 6; rank++) {
    pool.mark(0, ...cell)
    pool.image({ rank, eye: EYE, budget: 1, keep: 2 })
  }
  assert.equal(pool.tally().live, 1, 'the unread adaptive probe was given back')
  assert.equal(pool.adaptiveProbes[entry * POOL_ADAPTIVE.probes], 0)
  // The cell itself is no longer read: its probe goes, and an adaptive one with it.
  miss(pool.misses, entries, entry, 9, [64, 64, 64])
  pool.mark(0, ...cell)
  pool.image({ rank: 6, eye: EYE, budget: 1, keep: 2 })
  assert.equal(pool.tally().live, 2)
  for (let rank = 7; rank < 11; rank++) pool.image({ rank, eye: EYE, budget: 1, keep: 2 })
  assert.equal(pool.tally().live, 0, 'a cell no pixel reads gives both probes back')
  assert.equal(pool.adaptiveProbes[entry * POOL_ADAPTIVE.probes], 0)
})

test('a pool that is not adaptive takes no adaptive probe whatever the misses say', () => {
  const { pool, around, entryOf, cascades } = poolAt(EYE, 16, false)
  const cell = around(0, 0, 0, 0)
  pool.mark(0, ...cell)
  pool.image({ rank: 1, eye: EYE, budget: 1 })
  const entries = cascades.levels.length * cascades.cells
  assert.ok(entries > 0 && entryOf(0, cell) >= 0)
  pool.mark(0, ...cell)
  pool.image({ rank: 2, eye: EYE, budget: 1 })
  assert.equal(pool.tally().live, 1)
})
