// The pool's rules (`pool/poolWgsl.ts`) on its kernels run as JavaScript (`pool.fixture.ts`): which cells hold a probe, which probes are
// traced, in what order and at what cost, and what the lit passes may read of the table.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createBounceCascades } from '../../../../../sdk-core/src/bounce/cascades.ts'
import {
  BOUNCE_PROBE_QUEUE,
  BOUNCE_SETTINGS,
} from '../../../../../sdk-core/src/bounce/contracts.ts'
import { lcgRandom } from '../../../../../math/src/sequence/random.ts'
import { POOL_COST, POOL_WORK } from './poolLayout.ts'
import { cityPool, poolEntryOf, simulatedPool } from './pool.fixture.ts'

const { cascadeSize: SIDE, probeKeptMarks, settledTraces } = BOUNCE_SETTINGS

/** The levels around an eye at `eye` and a pool of `capacity` probes over them. */
function poolAt(eye: number[], capacity = 64) {
  const cascades = { ...createBounceCascades([0, 0, 0, 10, 10, 10]), probes: capacity }
  cascades.follow(eye)
  const pool = simulatedPool(cascades, capacity)
  /** The cell `dx, dy, dz` cells from the one the eye is in, in the level. */
  const around = (level: number, dx: number, dy: number, dz: number) => {
    const spacing = cascades.levels[level].spacing
    return [dx, dy, dz].map((d, axis) => Math.floor(eye[axis] / spacing) + d) as [
      number,
      number,
      number,
    ]
  }
  const entryOf = (level: number, [x, y, z]: number[]) => poolEntryOf(cascades, level, x, y, z)
  return { cascades, pool, around, entryOf }
}

test('a cell the image reads takes a probe from the pool, and keeps it while it is read', () => {
  const eye = [5, 5, 5]
  const { pool, around, entryOf } = poolAt(eye)
  const cell = around(0, 0, 0, 0)
  pool.mark(0, ...cell)
  pool.image({ rank: 1, eye, marking: true, budget: 1 })
  assert.equal(pool.tally().live, 1)
  assert.equal(
    pool.tally().unfilled,
    0,
    'a probe never traced is queued at once: the first update is not throttled',
  )
  const slot = pool.visible(entryOf(0, cell))
  assert.ok(slot >= 1)
  pool.mark(0, ...cell)
  pool.image({ rank: 2, eye, marking: true, budget: 1 })
  assert.equal(pool.tally().live, 1, 'the same cell, the same probe')
  assert.equal(pool.visible(entryOf(0, cell)), slot)
  pool.mark(1, ...around(1, 0, 0, 0))
  pool.image({ rank: 3, eye, marking: true, budget: 1 })
  assert.equal(pool.tally().live, 2, 'the same place in another level is another cell')
})

test('a pool with no probe left refuses a mark, and the cell goes unanswered', () => {
  const { pool, around } = poolAt([5, 5, 5], 3)
  for (let i = 0; i < 5; i++) pool.mark(0, ...around(0, i, 0, 0))
  pool.image({ rank: 1, eye: [5, 5, 5], marking: true, budget: 1 })
  assert.equal(pool.tally().live, 3)
  assert.equal(pool.tally().refused, 2)
  assert.equal(pool.tally().free, 0)
})

test('the probes that hold nothing come before every refresh, whatever the budget; filled, the frame holds to the budget again', () => {
  const eye = [5, 5, 5]
  const { pool, around } = poolAt(eye)
  for (const d of [10, 3, 0, 1, 20, 2]) pool.mark(0, ...around(0, d, 0, 0))
  pool.mark(1, ...around(1, 0, 0, 0))
  // A budget of one: the cells that hold nothing are not throttled by it.
  const first = pool.image({ rank: 2, eye, marking: true, budget: 1 })
  assert.equal(first.length, 7)
  assert.ok(first.every((entry) => entry.fresh))
  assert.equal(pool.tally().unfilled, 0)
  // Filled, the frame holds to the budget: ages are all alike, a budget of two names two.
  const refreshed = pool.image({ rank: 40, eye, marking: false, budget: 2 })
  assert.equal(refreshed.length, 2)
  assert.ok(refreshed.every((entry) => !entry.fresh))
})

test('a probe is told to the lit passes by its first trace, and forgotten the moment it is given back', () => {
  const eye = [5, 5, 5]
  const { pool, around, entryOf, cascades } = poolAt(eye, 2000)
  // More cells than the queue holds: those it leaves hold nothing and are named by no entry.
  const cells: [number, number, number][] = []
  for (let dx = -6; dx <= 6; dx++)
    for (let dy = -6; dy <= 6; dy++)
      for (let dz = -6; dz <= 6; dz++) cells.push(around(0, dx, dy, dz))
  for (const dz of [0, 1])
    for (const dy of [-8, -7]) for (const dx of [-20, 20]) cells.push(around(0, dx, dy, dz))
  cells.push(
    ...cells
      .map(([x, y, z]) => [x + 1, y, z + 13] as [number, number, number])
      .filter((c) => cascades.holds(0, ...c)),
  )
  for (const cell of cells) pool.mark(0, ...cell)
  const queued = pool.image({ rank: 2, eye, marking: true, budget: 1 })
  const entries = new Set(cells.map((cell) => entryOf(0, cell)))
  const named = [...entries].filter((entry) => pool.visible(entry) > 0)
  assert.equal(queued.length, BOUNCE_PROBE_QUEUE)
  assert.equal(named.length, queued.length, 'the cells named are the probes traced')
  assert.equal(pool.tally().live - pool.tally().unfilled, named.length)
  assert.ok(pool.tally().unfilled > 0, 'and the cells the queue left hold nothing')
  const slot = pool.visible(named[0])
  assert.ok(slot >= 1 && slot <= 2000, `the cell names its probe: ${slot}`)
  // Slid out of its level, the probe goes and the entry with it.
  const far = cascades.levels[0].spacing * (SIDE + 8)
  assert.equal(cascades.follow([5 + far, 5, 5]), true)
  pool.image({ rank: 3, eye: [5 + far, 5, 5], marking: false, slid: true, budget: 1 })
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
  pool.image({ rank: 1, eye, marking: true, budget: 8 })
  const slot = pool.visible(entryOf(0, kept))
  assert.ok(slot >= 1)
  // One cell of the finest level to the east: the lowest cell leaves, the middle one stays.
  const east = [5 + cascades.levels[0].spacing, 5, 5]
  assert.equal(cascades.follow(east), true)
  pool.image({ rank: 2, eye: east, marking: false, slid: true, budget: 8 })
  assert.equal(pool.tally().live, 1)
  assert.equal(pool.visible(entryOf(0, gone)), 0, 'the cell that left is forgotten')
  assert.equal(pool.visible(entryOf(0, kept)), slot, 'the other is untouched')
})

test('a probe nothing reads for the kept marks is given back, one that is read is not', () => {
  const eye = [5, 5, 5]
  const { pool, around } = poolAt(eye)
  const read = around(0, 0, 0, 0),
    unread = around(0, 1, 0, 0)
  pool.mark(0, ...read)
  pool.mark(0, ...unread)
  pool.image({ rank: 1, eye, marking: true, budget: 8 })
  for (let rank = 2; rank < 1 + probeKeptMarks; rank++) {
    pool.mark(0, ...read)
    pool.image({ rank, eye, marking: true, budget: 8 })
    assert.equal(pool.tally().live, 2, `image ${rank}`)
  }
  pool.mark(0, ...read)
  pool.image({ rank: 1 + probeKeptMarks, eye, marking: true, budget: 8 })
  assert.equal(pool.tally().live, 1)
})

test('a probe traced before is traced again by the age it has, over its level plus one', () => {
  const eye = [5, 5, 5]
  const { pool, around } = poolAt(eye)
  pool.mark(0, ...around(0, 0, 0, 0))
  pool.mark(0, ...around(0, 5, 0, 0))
  pool.mark(1, ...around(1, 0, 0, 0))
  const first = pool.image({ rank: 2, eye, marking: true, budget: 8 })
  const levels = new Map(first.map((entry) => [entry.slot, entry.level]))
  // Same age everywhere: the finer level's probes are worth more of a frame, so a budget of two takes both.
  const aged = pool.image({ rank: 40, eye, marking: false, budget: 2 })
  assert.deepEqual(aged.map((entry) => levels.get(entry.slot)).sort(), [0, 0])
  // The coarse probe, traced a long time ago, goes before the fine ones just traced.
  const next = pool.image({ rank: 41, eye, marking: false, budget: 1 })
  assert.equal(next.length, 1)
  assert.equal(levels.get(next[0].slot), 1, 'the oldest first')
})

test('a probe stops being traced after its updates, and the pool closes; a light brings them back', () => {
  const eye = [5, 5, 5]
  const { pool, around } = poolAt(eye)
  pool.mark(0, ...around(0, 0, 0, 0))
  let traced = 0
  let rank = 2
  traced += pool.image({ rank, eye, marking: true, budget: 8 }).length
  for (rank++; pool.tally().refreshing > 0; rank++) {
    assert.ok(rank < 1000, 'the series closes')
    traced += pool.image({ rank, eye, marking: false, budget: 8 }).length
  }
  assert.equal(traced, settledTraces, 'a probe takes exactly its updates')
  assert.deepEqual(
    pool.image({ rank, eye, marking: false, budget: 8 }),
    [],
    'a closed pool queues nothing',
  )
  assert.equal(
    pool.image({ rank: rank + 1, eye, marking: false, restart: true, budget: 8 }).length,
    1,
  )
  assert.equal(pool.tally().refreshing, 1)
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
  const queued = pool.image({ rank: 7, eye, marking: true, slid: true, budget: 8 })
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
    let slid = false,
      marking = false,
      restart = false
    if (roll < 0.6) {
      marking = true
      for (let k = 0; k < 8; k++) {
        const level = Math.floor(draw() * 4)
        const [x, y, z] = cellOf(level)
        pool.mark(level, x, y, z)
      }
    } else if (roll < 0.7) {
      for (let axis = 0; axis < 3; axis++)
        eye[axis] += (draw() - 0.5) * 6 * cascades.levels[0].spacing
      slid = cascades.follow(eye)
    } else if (roll < 0.83) restart = roll < 0.73
    pool.image({ rank, eye, marking: marking || slid, slid, restart, budget: 6 })
    const t = pool.tally()
    const named: number[] = []
    for (let entry = 0; entry < cascades.levels.length * cascades.cells; entry += 1) {
      const slot = pool.visible(entry)
      if (slot > 0) named.push(slot)
    }
    assert.equal(named.length, t.live - t.unfilled, `image ${rank}: published = traced`)
    assert.equal(new Set(named).size, named.length, 'a probe is named by one cell')
    assert.ok(t.live <= capacity && t.unfilled <= t.live)
    assert.ok(t.refreshing >= t.unfilled && t.refreshing <= t.live)
    assert.equal(t.free + t.live, capacity, 'every slot is held or free')
    refused = t.refused
  }
  assert.ok(refused > 0, 'a pool of forty is outgrown by the run')
})

test('a probe costs by its distance from the eye — a quarter of a map past the downsample distance, four maps within the supersample distance — and the budget is spent in that cost; a first trace the budget has no room for is told to be traced at half its side', () => {
  const eye = [100, 5, 100]
  // A budget of one probe has no room for the first traces the queue holds: every one is told to be downsampled.
  const starved = cityPool(eye)
  starved.read()
  const hungry = starved.pool.image({ rank: 2, eye, marking: true, budget: 1 })
  assert.equal(hungry.length, BOUNCE_PROBE_QUEUE)
  assert.ok(
    hungry.every((entry) => entry.fresh && entry.down),
    'no room: all downsampled',
  )
  // A budget of a thousand has room for each at its cost: none is.
  const fed = cityPool(eye)
  fed.read()
  assert.ok(
    fed.pool.image({ rank: 2, eye, marking: true, budget: 1000 }).every((entry) => !entry.down),
  )
  // The refreshes: the budget is four units a probe, a probe costs one, four or sixteen.
  const { pool, read } = cityPool(eye)
  read()
  pool.image({ rank: 2, eye, marking: true, budget: 1000 })
  for (let rank = 3; pool.tally().unfilled > 0; rank++)
    pool.image({ rank, eye, marking: false, budget: 1000 })
  const refreshed = (distances: [number, number], rank: number) =>
    pool.image({ rank, eye, marking: false, budget: 10, distances })
  const normal = refreshed([Infinity, 0], 200)
  assert.equal(normal.length, 10, 'a budget of ten probes: ten probes at the cost of a whole map')
  const far = refreshed([0, 0], 300)
  assert.equal(far.length, 40, 'a quarter of a map each: forty')
  const near = refreshed([Infinity, Infinity], 400)
  assert.equal(near.length, 2, 'sixteen units each: two, the third does not fit')
  assert.ok([...normal, ...far, ...near].every((entry) => !entry.fresh && !entry.down))
  assert.equal(POOL_COST.supersampled / POOL_COST.downsampled, 16)
})

test('the kernels over the slots are bounded by the slots ever given, the lowest first', () => {
  const eye = [5, 5, 5]
  const { pool, around } = poolAt(eye, 256)
  pool.image({ rank: 1, eye, marking: false, budget: 1 })
  assert.equal(pool.work[POOL_WORK.high], 0, 'no slot given: no group dispatched')
  for (let i = 0; i < 3; i++) pool.mark(0, ...around(0, i, 0, 0))
  pool.image({ rank: 2, eye, marking: true, budget: 1 })
  assert.equal(pool.work[POOL_WORK.high], 3)
  pool.image({ rank: 3, eye, marking: false, budget: 1 })
  assert.equal(pool.work[POOL_WORK.high], 3, 'what was given lasts')
})
