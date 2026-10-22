import test from 'node:test'
import assert from 'node:assert/strict'
import { createBounceCascades } from './cascades.ts'
import { BOUNCE_SETTINGS } from './contracts.ts'
import { createProbePool } from './probePool.ts'
import { applyMarks, markWords } from './probeMarks.ts'
import { TABLE_LANES } from './probeSlots.ts'
import { lcgRandom } from '../../../math/src/sequence/random.ts'

const { cascadeSize: SIDE, probeKeptMarks, settledTraces } = BOUNCE_SETTINGS

type Sent = { slot: number; level: number; cell: number[]; fresh: boolean }

/** The levels around an eye at `eye`, and a pool of `capacity` probes over them. */
function poolAt(eye: number[], capacity = 64) {
  const cascades = { ...createBounceCascades([0, 0, 0, 10, 10, 10]), probes: capacity }
  cascades.follow(eye)
  const pool = createProbePool(cascades)
  const sent: Sent[] = []
  const emit = (slot: number, level: number, x: number, y: number, z: number, fresh: boolean) =>
    void sent.push({ slot, level, cell: [x, y, z], fresh })
  /** The cell `dx, dy, dz` cells from the one the eye is in, in the level. */
  const around = (level: number, dx: number, dy: number, dz: number) => {
    const spacing = cascades.levels[level].spacing
    return [dx, dy, dz].map((d, axis) => Math.floor(eye[axis] / spacing) + d)
  }
  /** The entries the table names now, by cell remainder: what the GPU reads. */
  const table = () => {
    const entries = new Map<number, number>()
    pool.table(1e6, (texel, a, b, c, d) =>
      [a, b, c, d].forEach((slot, lane) => entries.set(texel * TABLE_LANES + lane, slot)),
    )
    return entries
  }
  const entryOf = (level: number, [x, y, z]: number[]) => {
    const wrap = (v: number) => ((v % SIDE) + SIDE) % SIDE
    return ((level * SIDE + wrap(z)) * SIDE + wrap(y)) * SIDE + wrap(x)
  }
  return { cascades, pool, sent, emit, around, table, entryOf }
}

test('a cell the image reads takes a probe from the pool, and keeps it while it is read', () => {
  const { pool, around, cascades } = poolAt([5, 5, 5])
  pool.mark(0, ...(around(0, 0, 0, 0) as [number, number, number]), 1)
  assert.equal(pool.live, 1)
  assert.equal(pool.unfilled, 1, 'a probe alive that holds nothing yet')
  pool.mark(0, ...(around(0, 0, 0, 0) as [number, number, number]), 2)
  assert.equal(pool.live, 1, 'the same cell, the same probe')
  pool.mark(1, ...(around(1, 0, 0, 0) as [number, number, number]), 2)
  assert.equal(pool.live, 2, 'the same place in another level is another cell')
  // A cell outside its level is no cell the image can read.
  const [bx, by, bz] = cascades.levels[0].base
  pool.mark(0, bx - 1, by, bz, 3)
  pool.mark(0, bx, by + SIDE, bz, 3)
  assert.equal(pool.live, 2)
})

test('a pool with no probe left refuses a mark, and the cell goes unanswered', () => {
  const { pool, around } = poolAt([5, 5, 5], 3)
  for (let i = 0; i < 5; i++) pool.mark(0, ...(around(0, i, 0, 0) as [number, number, number]), 1)
  assert.equal(pool.live, 3)
  assert.equal(pool.refused, 2)
})

test('the probes that hold nothing come before every refresh, finest level first, nearest cells first', () => {
  const { pool, sent, emit, around } = poolAt([5, 5, 5])
  for (const d of [10, 3, 0, 1, 20, 2])
    pool.mark(0, ...(around(0, d, 0, 0) as [number, number, number]), 1)
  pool.mark(1, ...(around(1, 0, 0, 0) as [number, number, number]), 1)
  // A queue of four, a budget of one: the cells that hold nothing are not throttled by the budget, only
  // by the queue.
  assert.equal(pool.probes(2, [5, 5, 5], 4, 1, emit), 4)
  const cells = sent.map((entry) => entry.cell[0] - around(0, 0, 0, 0)[0]).sort((a, b) => a - b)
  assert.deepEqual(cells, [0, 1, 2, 3], 'the four nearest of the finest level')
  assert.ok(sent.every((entry) => entry.fresh && entry.level === 0))
  // The rest, next image: the level of coarser cells last, still never a refresh before a cell that holds nothing.
  sent.length = 0
  assert.equal(pool.probes(3, [5, 5, 5], 4, 1, emit), 3)
  assert.deepEqual(
    sent.map((entry) => [entry.level, entry.fresh]),
    [
      [0, true],
      [0, true],
      [1, true],
    ],
  )
  assert.equal(pool.unfilled, 0)
  // Filled, the frame holds to the budget again.
  sent.length = 0
  assert.equal(pool.probes(4, [5, 5, 5], 4, 2, emit), 2)
  assert.ok(sent.every((entry) => !entry.fresh))
})

test('a probe is told to the GPU by its first trace, and forgotten the moment it is given back', () => {
  const { pool, emit, around, table, entryOf, cascades } = poolAt([5, 5, 5])
  const cell = around(0, 2, 1, 0)
  pool.mark(0, cell[0], cell[1], cell[2], 1)
  assert.equal(table().size, 0, 'a probe holding nothing is named by no entry')
  pool.probes(2, [5, 5, 5], 8, 8, emit)
  const named = table()
  const slot = named.get(entryOf(0, cell))
  assert.ok(slot && slot >= 1, `the cell names its probe: ${slot}`)
  assert.equal(named.size, TABLE_LANES, 'one texel: its four entries, the others naming none')
  assert.equal(
    [...named.entries()].filter(([entry, value]) => value && entry !== entryOf(0, cell)).length,
    0,
  )
  assert.equal(table().size, 0, 'a texel is told once')
  // Slid out of its level, the probe goes and the entry with it.
  const far = cascades.levels[0].spacing * (SIDE + 8)
  assert.equal(cascades.follow([5 + far, 5, 5]), true)
  pool.slide()
  assert.equal(pool.live, 0)
  assert.equal(table().get(entryOf(0, cell)), 0)
})

test('a level that slides keeps the probes of the cells it still holds, in the same slot', () => {
  const { pool, cascades, around, table, entryOf, emit } = poolAt([5, 5, 5])
  const kept = around(0, 0, 0, 0),
    gone = [cascades.levels[0].base[0], kept[1], kept[2]]
  pool.mark(0, kept[0], kept[1], kept[2], 1)
  pool.mark(0, gone[0], gone[1], gone[2], 1)
  pool.probes(2, [5, 5, 5], 8, 8, emit)
  const before = table()
  const slot = before.get(entryOf(0, kept))
  // One cell of the finest level to the east: the lowest cell leaves, the middle one stays.
  assert.equal(cascades.follow([5 + cascades.levels[0].spacing, 5, 5]), true)
  pool.slide()
  assert.equal(pool.live, 1)
  const after = table()
  assert.equal(after.get(entryOf(0, gone)), 0, 'the cell that left is forgotten')
  assert.equal(after.has(entryOf(0, kept)), false, 'the other is untouched: no texel is told')
  assert.ok(slot)
})

test('a probe nothing reads for the kept marks is given back, one that is read is not', () => {
  const { pool, around } = poolAt([5, 5, 5])
  const read = around(0, 0, 0, 0),
    unread = around(0, 1, 0, 0)
  pool.mark(0, read[0], read[1], read[2], 1)
  pool.mark(0, unread[0], unread[1], unread[2], 1)
  for (let frame = 2; frame < 1 + probeKeptMarks; frame++) {
    pool.mark(0, read[0], read[1], read[2], frame)
    pool.expire(frame)
    assert.equal(pool.live, 2, `frame ${frame}`)
  }
  pool.mark(0, read[0], read[1], read[2], 1 + probeKeptMarks)
  pool.expire(1 + probeKeptMarks)
  assert.equal(pool.live, 1)
})

test('a probe traced before is traced again by the age it has, over its level plus one', () => {
  const { pool, sent, emit, around } = poolAt([5, 5, 5])
  pool.mark(0, ...(around(0, 0, 0, 0) as [number, number, number]), 1)
  pool.mark(0, ...(around(0, 5, 0, 0) as [number, number, number]), 1)
  pool.mark(1, ...(around(1, 0, 0, 0) as [number, number, number]), 1)
  pool.probes(2, [5, 5, 5], 8, 8, emit)
  const levels = new Map(sent.map((entry) => [entry.slot, entry.level]))
  sent.length = 0
  // Same age everywhere: the finer level's probes are worth more of a frame, so a budget of two takes both.
  pool.probes(40, [5, 5, 5], 8, 2, emit)
  assert.deepEqual(
    sent.map((entry) => levels.get(entry.slot)),
    [0, 0],
  )
  // The coarse probe, traced a long time ago, goes before the fine ones just traced.
  sent.length = 0
  pool.probes(41, [5, 5, 5], 8, 1, emit)
  assert.equal(sent.length, 1)
  assert.equal(levels.get(sent[0].slot), 1, 'the oldest first')
})

test('a probe stops being traced after its updates, and the pool closes; a light brings them back', () => {
  const { pool, sent, emit, around } = poolAt([5, 5, 5])
  pool.mark(0, ...(around(0, 0, 0, 0) as [number, number, number]), 1)
  assert.equal(pool.working, true)
  let frame = 2
  for (; pool.working; frame++) {
    assert.ok(frame < 1000, 'the series closes')
    pool.probes(frame, [5, 5, 5], 8, 8, emit)
    pool.table(10, () => {})
  }
  assert.equal(sent.length, settledTraces, 'a probe takes exactly its updates')
  sent.length = 0
  pool.probes(frame, [5, 5, 5], 8, 8, emit)
  assert.deepEqual(sent, [], 'a closed pool queues nothing')
  pool.restart()
  assert.equal(pool.working, true)
  assert.equal(pool.probes(frame + 1, [5, 5, 5], 8, 8, emit), 1)
})

test('the marks of an image name their cells in the window it was made in', () => {
  const { pool, cascades, sent, emit, entryOf } = poolAt([5, 5, 5])
  // The image was made with the levels where they are; the eye then moves two cells east.
  const bases = cascades.levels.flatMap((level) => level.base)
  const bits = new Uint32Array(markWords(cascades))
  const west = cascades.levels[0].base.slice(),
    east = cascades.levels[0].base.map((b, axis) => b + (axis === 0 ? SIDE - 1 : 1))
  for (const [level, cell] of [
    [0, west],
    [0, east],
    [2, cascades.levels[2].base.map((b) => b + 5)],
  ] as const) {
    const entry = entryOf(level, cell as number[])
    bits[entry >> 5] |= 1 << (entry & 31)
  }
  cascades.follow([5 + 2 * cascades.levels[0].spacing, 5, 5])
  pool.slide()
  assert.equal(applyMarks(bits, bases, cascades, pool, 7), 3, 'every bit is a cell read')
  // The west cell is no longer in the level: only the two others take a probe.
  assert.equal(pool.live, 2)
  pool.probes(8, [5, 5, 5], 8, 8, emit)
  assert.deepEqual(sent.map((entry) => entry.level).sort(), [0, 2])
  const fine = sent.find((entry) => entry.level === 0)!
  assert.deepEqual(fine.cell, east, 'the cell, not its remainder')
  const coarse = sent.find((entry) => entry.level === 2)!
  assert.deepEqual(
    coarse.cell,
    bases.slice(6, 9).map((b) => b + 5),
  )
})

test('under any run of marks, slides, expiries and lights, the counts and the table the GPU holds stay exact', () => {
  const { cascades, pool, sent, emit } = poolAt([5, 5, 5], 40)
  const draw = lcgRandom(11)
  const eye = [5, 5, 5]
  const gpu = new Map<number, number>()
  const cellOf = (level: number) => {
    const { base } = cascades.levels[level]
    return base.map((b) => b + Math.floor(draw() * SIDE))
  }
  for (let frame = 2; frame < 1500; frame++) {
    const roll = draw()
    if (roll < 0.6) {
      const level = Math.floor(draw() * 4)
      const [x, y, z] = cellOf(level)
      pool.mark(level, x, y, z, frame)
    } else if (roll < 0.7) {
      for (let axis = 0; axis < 3; axis++)
        eye[axis] += (draw() - 0.5) * 6 * cascades.levels[0].spacing
      if (cascades.follow(eye)) pool.slide()
    } else if (roll < 0.8) pool.expire(frame)
    else if (roll < 0.83) pool.restart()
    sent.length = 0
    pool.probes(frame, eye, 8, 6, emit)
    pool.table(1e6, (texel, a, b, c, d) =>
      [a, b, c, d].forEach((slot, lane) => gpu.set(texel * TABLE_LANES + lane, slot)),
    )
    const named = [...gpu.values()].filter((slot) => slot > 0)
    assert.equal(named.length, pool.live - pool.unfilled, `frame ${frame}: published = traced`)
    assert.equal(new Set(named).size, named.length, 'a probe is named by one cell')
    assert.ok(pool.live <= pool.capacity && pool.unfilled <= pool.live)
    assert.ok(pool.refreshing >= pool.unfilled && pool.refreshing <= pool.live)
  }
  assert.ok(pool.refused > 0, 'a pool of forty is outgrown by the run')
})
