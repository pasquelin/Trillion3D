// `hold.ts` lets a frame hold once the bounce series has closed (`working` false). That loses no image
// only if a closed series writes nothing more: every probe and the
// grid uniform a redraw would read are then the ones the held frame read, so the redraw would
// draw the same pixels. Driven here on the engine's own probes, over a recording device.
import test from 'node:test'
import assert from 'node:assert/strict'
import { FLOOR_EYE, floorProbes } from './floorProbes.fixture.ts'
import { createBounceCascades } from '../../../../sdk-core/src/bounce/cascades.ts'
import { createProbePool } from '../../../../sdk-core/src/bounce/probePool.ts'
import { createBounceSchedule } from './schedule.ts'
import { PROBE_QUEUE_WORDS } from './probes/probeQueueWgsl.ts'
import { createMarkSurface } from './marks.ts'
import { markWords } from '../../../../sdk-core/src/bounce/probeMarks.ts'
import { BOUNCE_PROBE_QUEUE, BOUNCE_SETTINGS } from '../../../../sdk-core/src/bounce/contracts.ts'

test('a closed bounce series encodes and writes nothing: a redraw reads what the held frame read', async () => {
  const { gpu, probes, encoder } = await floorProbes()
  const eye = FLOOR_EYE
  let frames = 0
  while (probes.working) {
    assert.ok(++frames < 100_000, 'the series closes')
    probes.encode(encoder, 1, eye)
    // As the engine does after each submit (`frame/render/encoder.ts`): the cells the rays hit come back
    // through the ring, and the series is open until they have.
    probes.submitted()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  assert.ok(gpu.dispatches.length > 0, 'the series traced probes before it closed')
  const writes = gpu.writes.length,
    encoded = gpu.commands.length
  for (let frame = 0; frame < 8; frame++) assert.equal(probes.encode(encoder, 1, eye), false)
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
  assert.equal(probes.encode(encoder, 1, FLOOR_EYE, surface), true, 'the image marks')
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
    probes.encode(encoder, 1, FLOOR_EYE, surface)
  }
  assert.equal(probes.pool.live, 1, 'the cell the image read holds a probe')
  assert.equal(probes.unfilled, 0)
  assert.ok(gpu.dispatches.length > 0)
  // Closed, a still view marked in full costs nothing more.
  const writes = gpu.writes.length,
    commands = gpu.commands.length
  assert.equal(probes.encode(encoder, 1, FLOOR_EYE, surface), false)
  assert.equal(gpu.writes.length, writes)
  assert.equal(gpu.commands.length, commands)
  assert.ok(BOUNCE_SETTINGS.markJitter >= 1)
  // The view stands still but what it draws changed — the cut refined, pages arrived —: the cells of
  // the surfaces it now shows were never marked, so the image marks again, `markJitter` marks, then none.
  surface.signature[36] += 1
  assert.equal(probes.encode(encoder, 1, FLOOR_EYE, surface), true, 'a changed cut marks again')
  assert.equal(probes.working, true, 'marks owed and in flight')
  for (frames = 0; probes.working;) {
    assert.ok(++frames < 200, 'the series closes again')
    probes.submitted()
    await landed()
    probes.encode(encoder, 1, FLOOR_EYE, surface)
  }
  assert.equal(
    probes.encode(encoder, 1, FLOOR_EYE, surface),
    false,
    'then a still image marks nothing',
  )
})

test('the cells the probes’ rays hit come back with the batch, take probes of their own and are kept', async () => {
  const { gpu, probes, encoder } = await floorProbes()
  const landed = () => new Promise((resolve) => setTimeout(resolve, 0))
  const staged = () => gpu.buffers.filter((b) => b.label === 'Trillion3D bounce hit marks readback')
  const floor = probes.pool.live
  assert.ok(floor > 0)
  // An image that traces probes copies the bitmap of the cells their rays hit, then clears it.
  assert.equal(probes.encode(encoder, 1, FLOOR_EYE), true)
  assert.ok(probes.lastProbes > 0)
  assert.equal(staged().length, 1, 'a staging buffer of its own ring')
  assert.deepEqual(
    gpu.commands.filter((command) => command === 'clear' || command === 'copy'),
    ['clear', 'copy', 'clear', 'copy'],
    'the census cleared, the pass, the hits copied then cleared — never before —, the census copied',
  )
  // The pass set one bit, as a ray that hit a surface far above the floor would (level 0, 24 cells in).
  const words = markWords(probes.cascades)
  const cell = probes.cascades.levels[0].base.map((b) => b + 24)
  const wrap = (v: number) => ((v % 48) + 48) % 48
  const entry = (wrap(cell[2]) * 48 + wrap(cell[1])) * 48 + wrap(cell[0])
  new Uint32Array(staged()[0].data!.buffer, 0, words)[entry >> 5] |= 1 << (entry & 31)
  assert.equal(probes.working, true, 'the series is open until they came')
  probes.submitted()
  await landed()
  assert.equal(probes.pool.live, floor + 1, 'the cell the ray hit holds a probe')
  // No age takes it back: the floor, read by the image at frame 1, goes after the kept marks.
  probes.pool.expire(1_000_000)
  assert.equal(probes.pool.live, 1, 'only the cell a ray hit is kept')
})
