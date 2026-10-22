// `hold.ts` lets a frame hold once the bounce series has closed (`working` false). That loses no image
// only if a closed series writes nothing more: every probe and the
// grid uniform a redraw would read are then the ones the held frame read, so the redraw would
// draw the same pixels. Driven here on the engine's own probes, over a recording device.
import test from 'node:test'
import assert from 'node:assert/strict'
import { FLOOR_ATLAS, FLOOR_EYE, FLOOR_SHADE, floorProbes } from './floorProbes.fixture.ts'
import { createBounceCascades } from '../../../../sdk-core/src/bounce/cascades.ts'
import { createProbePool } from '../../../../sdk-core/src/bounce/probePool.ts'
import { createBounceSchedule } from './schedule.ts'
import { PROBE_QUEUE_WORDS } from './probes/probeQueueWgsl.ts'
import { screenProbeSettings } from '../../../../sdk-core/src/bounce/screenProbeOptions.fixture.ts'
import { createMarkSurface } from './marks.ts'
import { markWords } from '../../../../sdk-core/src/bounce/probeMarks.ts'
import { BOUNCE_PROBE_QUEUE, BOUNCE_SETTINGS } from '../../../../sdk-core/src/bounce/contracts.ts'

test('a closed bounce series encodes and writes nothing: a redraw reads what the held frame read', async () => {
  const { gpu, probes, encoder } = await floorProbes()
  const eye = FLOOR_EYE
  let frames = 0
  while (probes.working) {
    assert.ok(++frames < 100_000, 'the series closes')
    probes.encode(encoder, 1, eye, FLOOR_ATLAS, FLOOR_SHADE)
  }
  assert.ok(gpu.dispatches.length > 0, 'the series traced probes before it closed')
  const writes = gpu.writes.length,
    encoded = gpu.commands.length
  for (let frame = 0; frame < 8; frame++)
    assert.equal(probes.encode(encoder, 1, eye, FLOOR_ATLAS, FLOOR_SHADE), false)
  assert.deepEqual(gpu.commands.slice(encoded), [], 'no pass, copy or clear once closed')
  assert.equal(gpu.writes.length, writes, 'no buffer written once closed')
  assert.equal(probes.working, false)
  assert.equal(probes.unfilled, 0, 'a closed series holds light in every probe it keeps')
  assert.ok(probes.pool.live > 0, 'and keeps probes')
})

/** A city-sized scene read around an eye: every cell within six of the cell the eye is in, in the two
 *  finest levels, marked; the pool, its schedule, and the entries one plan queued — each its slot,
 *  its level, whether it is a first trace, its cell. */
function cityQueue(eye: number[]) {
  const cascades = createBounceCascades([0, 0, 0, 200, 30, 200])
  cascades.follow(eye)
  const pool = createProbePool(cascades)
  const schedule = createBounceSchedule(pool)
  const words = new Int32Array(schedule.queue.buffer)
  const entries = (groups: number) =>
    Array.from({ length: groups }, (_, at) => {
      const first = words[at * PROBE_QUEUE_WORDS]
      return {
        slot: first & 0xffff,
        level: (first >> 16) & 0xff,
        fresh: (first & (1 << 24)) !== 0,
        down: (first & (1 << 25)) !== 0,
        cell: [1, 2, 3].map((word) => words[at * PROBE_QUEUE_WORDS + word]),
      }
    })
  const read = (frame: number) => {
    for (let level = 0; level < 2; level++) {
      const base = cascades.levels[level].spacing
      const at = eye.map((v) => Math.floor(v / base))
      for (let dz = -6; dz <= 6; dz++)
        for (let dy = -6; dy <= 6; dy++)
          for (let dx = -6; dx <= 6; dx++)
            pool.mark(level, at[0] + dx, at[1] + dy, at[2] + dz, frame)
    }
  }
  return { cascades, pool, schedule, entries, read }
}

/** The squared distance, in cells of the level, from a cell to the one the eye is in. */
const cellsFrom = (spacing: number, eye: number[], cell: number[]) =>
  cell.reduce((sum, c, axis) => sum + (c - Math.floor(eye[axis] / spacing)) ** 2, 0)

test('the probes that hold nothing fill before any refresh: finest level first, nearest cells first', () => {
  const eye = [100, 5, 100]
  const { cascades, pool, schedule, entries, read } = cityQueue(eye)
  read(1)
  const spacing = cascades.levels[0].spacing
  // A budget of ten probes: the cells that hold nothing are not throttled by it, the queue is.
  const queued = entries(schedule.plan(2, eye, 10))
  assert.equal(queued.length, BOUNCE_PROBE_QUEUE, 'the queue fills past a budget of ten')
  assert.ok(
    queued.every((entry) => entry.fresh && entry.level === 0),
    'the finest level first',
  )
  const away = queued.map((entry) => cellsFrom(spacing, eye, entry.cell))
  // The queue holds the cells nearest the eye, by whole cells of distance: none left out is a whole
  // cell nearer than the farthest one taken.
  const whole = (squared: number) => Math.floor(Math.sqrt(squared))
  const taken = new Set(queued.map((entry) => entry.cell.join()))
  const farthest = whole(Math.max(...away))
  let leftNearer = 0
  for (let dz = -6; dz <= 6; dz++)
    for (let dy = -6; dy <= 6; dy++)
      for (let dx = -6; dx <= 6; dx++) {
        const cell = eye.map((v, axis) => Math.floor(v / spacing) + [dx, dy, dz][axis])
        if (!taken.has(cell.join()) && whole(cellsFrom(spacing, eye, cell)) < farthest) leftNearer++
      }
  assert.equal(leftNearer, 0, 'never a farther cell before a nearer one')
  assert.equal(Math.min(...away), 0, 'the cell the eye is in comes with them')
  // Run on, the cells fill and the count of those left falls to zero. A plan queues a refresh only
  // once no cell is left that holds nothing: a probe already filled is refreshed after every empty one.
  for (let frame = 3; pool.unfilled > 0; frame++) {
    assert.ok(frame < 100, 'the cells fill')
    const sent = entries(schedule.plan(frame, eye, 10))
    if (sent.some((entry) => !entry.fresh))
      assert.equal(pool.unfilled, 0, 'no refresh before a cell that holds nothing')
  }
  // Filled, the frame holds to the budget again.
  assert.ok(schedule.plan(100, eye, 10) <= 10)
})

test('an eye that jumps leaves the cells it lands among empty, and they fill nearest first', () => {
  const eye = [100, 5, 100]
  const { cascades, pool, schedule, entries, read } = cityQueue(eye)
  read(1)
  for (let frame = 2; pool.unfilled > 0; frame++) schedule.plan(frame, eye, 10)
  const landed = [30, 8, 160]
  assert.equal(cascades.follow(landed), true)
  pool.slide()
  const before = pool.live
  // The cells the old eye read are mostly out of the finest level now: given back, and the new ones read.
  assert.ok(before < 2 * 13 ** 3, 'the cells that left are given back')
  for (let level = 0; level < 2; level++) {
    const spacing = cascades.levels[level].spacing
    const at = landed.map((v) => Math.floor(v / spacing))
    for (let dz = -6; dz <= 6; dz++)
      for (let dy = -6; dy <= 6; dy++)
        for (let dx = -6; dx <= 6; dx++) pool.mark(level, at[0] + dx, at[1] + dy, at[2] + dz, 40)
  }
  assert.ok(pool.unfilled > 0, 'the cells under the eye hold nothing')
  const queued = entries(schedule.plan(41, landed, 10))
  const spacing = cascades.levels[0].spacing
  const away = queued.map((entry) => cellsFrom(spacing, landed, entry.cell))
  assert.equal(Math.min(...away), 0)
  assert.ok(
    queued.every((entry) => entry.fresh),
    'what holds nothing before any refresh',
  )
  while (pool.unfilled > 0) schedule.plan(42 + pool.unfilled, landed, 10)
  assert.equal(pool.unfilled, 0, 'the cells fill again')
})

test('the cells an image reads are marked by its pass, read back a few images late, and the series stays open until they came', async () => {
  const { gpu, probes, encoder } = await floorProbes(false, false)
  const texture = (format: GPUTextureFormat) =>
    gpu.device
      .createTexture({ size: [64, 64, 1], format, usage: GPUTextureUsage.TEXTURE_BINDING })
      .createView()
  const surface = createMarkSurface()
  surface.depth = texture('depth32float')
  surface.normals = texture('rgba16float')
  surface.view = gpu.device.createBuffer({ size: 256, usage: GPUBufferUsage.UNIFORM })
  surface.size = [64, 64]
  surface.signature.set([1, 2, 3], 0)
  const landed = () => new Promise((resolve) => setTimeout(resolve, 0))
  const staged = () => gpu.buffers.filter((b) => b.label === 'Trillion3D bounce marks readback')
  // Nothing is read yet: the pool holds no probe, the series has no probe to trace, yet it is open.
  assert.equal(probes.pool.live, 0)
  assert.equal(
    probes.encode(encoder, 1, FLOOR_EYE, FLOOR_ATLAS, FLOOR_SHADE, surface),
    true,
    'the image marks',
  )
  const marked = gpu.commands.filter((command) => command === 'clear' || command === 'copy')
  assert.deepEqual(marked, ['clear', 'copy'], 'the bitmap cleared, the pass, the bitmap copied')
  assert.equal(probes.lastProbes, 0, 'no probe to trace before a cell is read')
  assert.equal(probes.working, true, 'marks owed and in flight')
  // The same view marks again, a jitter on: `markJitter` marks, then none.
  const words = markWords(probes.cascades)
  const cell = probes.cascades.levels[0].base.map((b) => b + 24)
  const wrap = (v: number) => ((v % 48) + 48) % 48
  const entry = (wrap(cell[2]) * 48 + wrap(cell[1])) * 48 + wrap(cell[0])
  let frames = 0
  while (probes.working) {
    assert.ok(++frames < 200, 'the series closes')
    // What the pass wrote lands in the staging buffer the image copied it into: one cell, level 0.
    const [last] = staged().slice(-1)
    new Uint32Array(last.data!.buffer, 0, words)[entry >> 5] |= 1 << (entry & 31)
    probes.submitted()
    await landed()
    probes.encode(encoder, 1, FLOOR_EYE, FLOOR_ATLAS, FLOOR_SHADE, surface)
  }
  assert.equal(probes.pool.live, 1, 'the cell the image read holds a probe')
  assert.equal(probes.unfilled, 0)
  assert.ok(gpu.dispatches.length > 0)
  // Closed, a still view marked in full costs nothing more.
  const writes = gpu.writes.length,
    commands = gpu.commands.length
  assert.equal(probes.encode(encoder, 1, FLOOR_EYE, FLOOR_ATLAS, FLOOR_SHADE, surface), false)
  assert.equal(gpu.writes.length, writes)
  assert.equal(gpu.commands.length, commands)
  assert.ok(BOUNCE_SETTINGS.markJitter >= 1)
  // The view stands still but what it draws changed — the cut refined, pages arrived —: the cells of
  // the surfaces it now shows were never marked, so the image marks again, `markJitter` marks, then none.
  surface.signature[36] += 1
  assert.equal(
    probes.encode(encoder, 1, FLOOR_EYE, FLOOR_ATLAS, FLOOR_SHADE, surface),
    true,
    'a changed cut marks again',
  )
  assert.equal(probes.working, true, 'marks owed and in flight')
  for (frames = 0; probes.working;) {
    assert.ok(++frames < 200, 'the series closes again')
    probes.submitted()
    await landed()
    probes.encode(encoder, 1, FLOOR_EYE, FLOOR_ATLAS, FLOOR_SHADE, surface)
  }
  assert.equal(
    probes.encode(encoder, 1, FLOOR_EYE, FLOOR_ATLAS, FLOOR_SHADE, surface),
    false,
    'then a still image marks nothing',
  )
})

test('a probe costs by its distance from the eye — a quarter of a map past the downsample distance, four maps within the supersample distance — and the budget is spent in that cost; a first trace the budget has no room for is told to be traced at half its side', () => {
  const eye = [100, 5, 100]
  // A budget of one probe has no room for the first traces the queue holds: every one is told to be downsampled.
  const starved = cityQueue(eye)
  starved.read(1)
  const hungry = starved.entries(starved.schedule.plan(2, eye, 1))
  assert.equal(hungry.length, BOUNCE_PROBE_QUEUE)
  assert.ok(
    hungry.every((entry) => entry.fresh && entry.down),
    'no room: all downsampled',
  )
  // A budget of a thousand has room for each at its cost: none is.
  const fed = cityQueue(eye)
  fed.read(1)
  assert.ok(fed.entries(fed.schedule.plan(2, eye, 1000)).every((entry) => !entry.down))
  // The refreshes: the budget is four units a probe, a probe costs one, four or sixteen.
  const { pool, schedule, entries, read } = cityQueue(eye)
  read(1)
  for (let frame = 2; pool.unfilled > 0; frame++) schedule.plan(frame, eye, 1000)
  const refreshed = (costs: { downsampleSq: number; supersampleSq: number }, frame: number) =>
    entries(schedule.plan(frame, eye, 10, costs))
  const normal = refreshed({ downsampleSq: Infinity, supersampleSq: 0 }, 200)
  assert.equal(normal.length, 10, 'a budget of ten probes: ten probes at the cost of a whole map')
  const far = refreshed({ downsampleSq: 0, supersampleSq: 0 }, 300)
  assert.equal(far.length, 40, 'a quarter of a map each: forty')
  const near = refreshed({ downsampleSq: Infinity, supersampleSq: Infinity }, 400)
  assert.equal(near.length, 2, 'sixteen units each: two, the third does not fit')
  assert.ok([...normal, ...far, ...near].every((entry) => !entry.fresh && !entry.down))
})

test('a closed series finds work again when a level that casts is chosen: the radiance cache is made, every probe is traced anew; given back where no screen probe reads it', async () => {
  let level: 'low' | 'ultra' = 'low'
  const { probes, encoder } = await floorProbes(false, true, () =>
    screenProbeSettings({ screenProbes: level }),
  )
  for (let frames = 0; probes.working; frames++) {
    assert.ok(frames < 100_000, 'the series closes')
    probes.encode(encoder, 1, FLOOR_EYE)
  }
  assert.equal(probes.cache.views, undefined, 'a level that casts none keeps no maps')
  assert.equal(probes.encode(encoder, 1, FLOOR_EYE), false, 'closed')
  level = 'ultra'
  assert.equal(
    probes.encode(encoder, 1, FLOOR_EYE),
    true,
    'the maps are made: every probe is traced anew',
  )
  assert.ok(probes.cache.views && probes.cache.bytes > 0)
  assert.equal(probes.cache.pending, true)
  for (let frames = 0; probes.working; frames++) {
    assert.ok(frames < 100_000, 'the series closes again')
    probes.encode(encoder, 1, FLOOR_EYE)
  }
  level = 'low'
  assert.equal(probes.encode(encoder, 1, FLOOR_EYE), false)
  assert.equal(probes.cache.views, undefined, 'given back')
  probes.dispose()
})
