// The pool's rules (`pool/poolWgsl.ts`) on its kernels run as JavaScript (`pool.fixture.ts`): which cells hold a probe, what the lit passes
// may read of the table, and the counts that stay exact under any run.
import test from 'node:test'
import assert from 'node:assert/strict'
import { BOUNCE_SETTINGS } from '../../../../../sdk-core/src/bounce/contracts.ts'
import { lcgRandom } from '../../../../../math/src/sequence/random.ts'
import { poolAt, queueFor } from './pool.fixture.ts'

const { cascadeSize: SIDE } = BOUNCE_SETTINGS

test('a cell the image reads takes a probe from the pool, and keeps it while it is read', () => {
  const eye = [5, 5, 5]
  const { pool, around, entryOf } = poolAt(eye)
  const cell = around(0, 0, 0, 0)
  pool.mark(0, ...cell)
  pool.image({ rank: 1, eye, budget: 1 })
  assert.equal(pool.tally().live, 1)
  assert.equal(
    pool.tally().unfilled,
    0,
    'a probe never traced is queued at once: the first update is not throttled',
  )
  const slot = pool.visible(entryOf(0, cell))
  assert.ok(slot >= 1)
  pool.mark(0, ...cell)
  pool.image({ rank: 2, eye, budget: 1 })
  assert.equal(pool.tally().live, 1, 'the same cell, the same probe')
  assert.equal(pool.visible(entryOf(0, cell)), slot)
  pool.mark(1, ...around(1, 0, 0, 0))
  pool.image({ rank: 3, eye, budget: 1 })
  assert.equal(pool.tally().live, 2, 'the same place in another level is another cell')
})

test('a pool with no probe left refuses a mark, and the cell goes unanswered', () => {
  const { pool, around } = poolAt([5, 5, 5], 3)
  for (let i = 0; i < 5; i++) pool.mark(0, ...around(0, i, 0, 0))
  pool.image({ rank: 1, eye: [5, 5, 5], budget: 1 })
  assert.equal(pool.tally().live, 3)
  assert.equal(pool.tally().refused, 2)
  assert.equal(pool.tally().free, 0)
})

test('a probe is told to the lit passes by its first trace, and forgotten the moment it is given back', () => {
  const eye = [5, 5, 5]
  const queue = queueFor(1)
  const slots = queue + 1000
  const { pool, around, entryOf, cascades } = poolAt(eye, slots)
  // More cells than the queue holds — a cube whose side is past the queue's cube root —: those it leaves hold nothing and are
  // named by no entry.
  const reach = Math.ceil(Math.cbrt(queue) / 2)
  const cells: [number, number, number][] = []
  for (let dx = -reach; dx <= reach; dx++)
    for (let dy = -reach; dy <= reach; dy++)
      for (let dz = -reach; dz <= reach; dz++) cells.push(around(0, dx, dy, dz))
  for (const dz of [0, 1])
    for (const dy of [-8, -7]) for (const dx of [-20, 20]) cells.push(around(0, dx, dy, dz))
  cells.push(
    ...cells
      .map(([x, y, z]) => [x + 1, y, z + 13] as [number, number, number])
      .filter((c) => cascades.holds(0, ...c)),
  )
  for (const cell of cells) pool.mark(0, ...cell)
  const queued = pool.image({ rank: 2, eye, budget: 1 })
  const entries = new Set(cells.map((cell) => entryOf(0, cell)))
  const named = [...entries].filter((entry) => pool.visible(entry) > 0)
  assert.equal(queued.length, queue)
  assert.equal(named.length, queued.length, 'the cells named are the probes traced')
  assert.equal(pool.tally().live - pool.tally().unfilled, named.length)
  assert.ok(pool.tally().unfilled > 0, 'and the cells the queue left hold nothing')
  const slot = pool.visible(named[0])
  assert.ok(slot >= 1 && slot <= slots, `the cell names its probe: ${slot}`)
  // Slid out of its level, the probe goes and the entry with it.
  const far = cascades.levels[0].spacing * (SIDE + 8)
  assert.equal(cascades.follow([5 + far, 5, 5]), true)
  pool.image({ rank: 3, eye: [5 + far, 5, 5], budget: 1 })
  assert.equal(pool.tally().live, 0)
  assert.ok(named.every((entry) => pool.visible(entry) === 0))
})

test('a level that slides keeps the probes of the cells it still holds, in the same slot', () => {
  const eye = [5, 5, 5]
  const { pool, cascades, around, entryOf } = poolAt(eye)
  const kept = around(0, 0, 0, 0),
    gone = [cascades.levels[0].base[0], kept[1], kept[2]]
  pool.mark(0, ...kept)
  pool.mark(0, gone[0], gone[1], gone[2])
  pool.image({ rank: 1, eye, budget: 8 })
  const slot = pool.visible(entryOf(0, kept))
  assert.ok(slot >= 1)
  // One cell of the finest level to the east: the lowest cell leaves, the middle one stays.
  const east = [5 + cascades.levels[0].spacing, 5, 5]
  assert.equal(cascades.follow(east), true)
  pool.image({ rank: 2, eye: east, budget: 8 })
  assert.equal(pool.tally().live, 1)
  assert.equal(pool.visible(entryOf(0, gone)), 0, 'the cell that left is forgotten')
  assert.equal(pool.visible(entryOf(0, kept)), slot, 'the other is untouched')
})

test('a probe queued names its cell, not the remainder of it', () => {
  const eye = [5, 5, 5]
  const { pool, cascades, entryOf } = poolAt(eye)
  // The eye moves two cells east before the image marks: the cells are those of the levels where they are.
  cascades.follow([5 + 2 * cascades.levels[0].spacing, 5, 5])
  const west = cascades.levels[0].base.slice(),
    east = cascades.levels[0].base.map((b, axis) => b + (axis === 0 ? SIDE - 1 : 1))
  const coarse = cascades.levels[2].base.map((b) => b + 5)
  for (const [level, cell] of [
    [0, west],
    [0, east],
    [2, coarse],
  ] as const)
    pool.mark(level, cell[0], cell[1], cell[2])
  const queued = pool.image({ rank: 7, eye, budget: 8 })
  assert.equal(pool.tally().marked, 3, 'every bit is a cell read')
  assert.equal(queued.length, 3)
  assert.deepEqual(
    queued.find((entry) => entry.level === 0 && entry.cell.join() === east.join())?.cell,
    east,
  )
  assert.deepEqual(queued.find((entry) => entry.level === 2)?.cell, coarse)
  assert.ok(pool.visible(entryOf(0, east)) > 0)
})

test('under any run of marks, slides, expiries and lights, the counts and the table the lit passes hold stay exact', () => {
  const capacity = 40
  const { cascades, pool } = poolAt([5, 5, 5], capacity)
  const draw = lcgRandom(11)
  const eye = [5, 5, 5]
  const cellOf = (level: number) =>
    cascades.levels[level].base.map((b) => b + Math.floor(draw() * SIDE))
  let refused = 0
  for (let rank = 2; rank < 400; rank++) {
    const roll = draw()
    let restart = false
    if (roll < 0.6) {
      for (let k = 0; k < 8; k++) {
        const level = Math.floor(draw() * 4)
        const [x, y, z] = cellOf(level)
        pool.mark(level, x, y, z)
      }
    } else if (roll < 0.7) {
      for (let axis = 0; axis < 3; axis++)
        eye[axis] += (draw() - 0.5) * 6 * cascades.levels[0].spacing
      cascades.follow(eye)
    } else if (roll < 0.83) restart = roll < 0.73
    pool.image({ rank, eye, restart, budget: 6 })
    const t = pool.tally()
    const named: number[] = []
    for (let entry = 0; entry < cascades.levels.length * cascades.cells; entry += 1) {
      const slot = pool.visible(entry)
      if (slot > 0) named.push(slot)
    }
    assert.equal(named.length, t.live - t.unfilled, `image ${rank}: published = traced`)
    assert.equal(new Set(named).size, named.length, 'a probe is named by one cell')
    assert.ok(t.live <= capacity && t.unfilled <= t.live)
    assert.ok(t.unfilled <= t.refreshing && t.refreshing <= t.live)
    assert.equal(t.free + t.live, capacity, 'every slot is held or free')
    refused = t.refused
  }
  assert.ok(refused > 0, 'a pool of forty is outgrown by the run')
})
