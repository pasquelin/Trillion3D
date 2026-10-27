// `hold.ts` lets a frame hold once the bounce series has closed (`working` false). That loses no image
// only if a closed series writes nothing more: every probe and the
// grid uniform a redraw would read are then the ones the held frame read, so the redraw would
// draw the same pixels. Driven here on the engine's own probes, over a recording device; the pool's own
// choices (which cells hold a probe, which probes are traced first) on its kernels run as JavaScript.
import test from 'node:test'
import assert from 'node:assert/strict'
import { FLOOR_SKY, FLOOR_EYE, FLOOR_READS, floorProbes } from './floorProbes.fixture.ts'
import { screenProbeSettings } from '../../../../sdk-core/src/bounce/screenProbeOptions.fixture.ts'
import { createMarkSurface } from './pool/pool.ts'
import { POOL_WORK } from './pool/poolLayout.ts'
import { CITY_REACH, cityPool } from './pool/pool.fixture.ts'
import { BOUNCE_PROBE_QUEUE, BOUNCE_SETTINGS } from '../../../../sdk-core/src/bounce/contracts.ts'

type Floor = Awaited<ReturnType<typeof floorProbes>>
const landed = () => new Promise((resolve) => setTimeout(resolve, 0))

/** What the pass counted, written into the staging buffer the image copied its statistics into, as the GPU would have. */
function countAs(
  gpu: Floor['gpu'],
  counted: { live: number; unfilled?: number; refreshing?: number; queued?: number },
) {
  const [last] = gpu.buffers
    .filter((b) => b.label === 'Trillion3D bounce pool statistics readback')
    .slice(-1)
  const words = new Uint32Array(last.data!.buffer, 0, POOL_WORK.stats)
  words[POOL_WORK.live] = counted.live
  words[POOL_WORK.unfilled] = counted.unfilled ?? 0
  words[POOL_WORK.refreshing] = counted.refreshing ?? 0
  words[POOL_WORK.queued] = counted.queued ?? 0
}

/** An image's probe pass as the frame encodes it: the viewpoint taken (`track`), then the pass. */
const encodeImage = (probes: Floor['probes'], ...args: Parameters<Floor['probes']['encode']>) => (
  probes.track(args[2]),
  probes.encode(...args)
)

/** Encodes images until the series closes, the statistics of each coming back before the next (`counted`: the GPU's count of the probes). */
async function closeSeries(
  floor: Floor,
  counted: { live: number },
  ...surface: Parameters<Floor['probes']['encode']>[5][]
) {
  const { gpu, probes, encoder } = floor
  for (let frames = 0; probes.working; frames++) {
    assert.ok(frames < 1000, 'the series closes')
    encodeImage(probes, encoder, 1, FLOOR_EYE, FLOOR_SKY, FLOOR_READS, ...surface)
    countAs(gpu, counted)
    probes.submitted()
    await landed()
  }
}

test('a closed bounce series encodes and writes nothing: a redraw reads what the held frame read', async () => {
  const floor = await floorProbes()
  const { gpu, probes, encoder } = floor
  // The lights changed: every probe is traced anew, and the series is open till the pass's count came back.
  probes.restart()
  assert.equal(probes.working, true)
  await closeSeries(floor, { live: 12 })
  assert.ok(gpu.dispatches.length > 0, 'the series traced probes before it closed')
  const writes = gpu.writes.length,
    encoded = gpu.commands.length
  for (let frame = 0; frame < 8; frame++)
    assert.equal(encodeImage(probes, encoder, 1, FLOOR_EYE, FLOOR_SKY, FLOOR_READS), false)
  assert.deepEqual(gpu.commands.slice(encoded), [], 'no pass, copy or clear once closed')
  assert.equal(gpu.writes.length, writes, 'no buffer written once closed')
  assert.equal(probes.working, false)
  assert.equal(probes.stats.unfilled, 0, 'a closed series holds light in every probe it keeps')
  assert.equal(probes.stats.live, 12, 'and keeps probes')
})

test('a restart not yet encoded keeps the series open, whatever statistics land first', async () => {
  const floor = await floorProbes()
  const { gpu, probes, encoder } = floor
  probes.restart()
  await closeSeries(floor, { live: 3 })
  assert.equal(probes.working, false)
  probes.restart()
  assert.equal(probes.working, true, 'the lights changed: the probes are to be traced anew')
  encodeImage(probes, encoder, 1, FLOOR_EYE, FLOOR_SKY, FLOOR_READS)
  countAs(gpu, { live: 3, refreshing: 3 })
  probes.submitted()
  await landed()
  assert.equal(probes.working, true, 'and the probes the pass counted are short of their updates')
})

test("the probes the pass queued are the GPU's to count: every dispatch over them is indirect, from the arguments the pass wrote", async () => {
  const floor = await floorProbes()
  const { gpu, probes, encoder } = floor
  probes.restart()
  assert.equal(encodeImage(probes, encoder, 1, FLOOR_EYE, FLOOR_SKY, FLOOR_READS), true)
  assert.ok(
    gpu.dispatches.some((dispatch) => dispatch.entryPoint === 'finishQueue'),
    'the pool writes them last',
  )
  // The radiance cache makes their maps in a pass of its own, each dispatch over them taking its group count from a buffer.
  probes.cache.flush(encoder)
  const maps = gpu.dispatches.filter((dispatch) =>
    ['generateTiles', 'filterMaps'].includes(dispatch.entryPoint ?? ''),
  )
  assert.equal(maps.length, 2, 'the tiles and the filter')
  assert.ok(maps.every((dispatch) => dispatch.buffer))
  assert.equal(probes.lastProbes, 0, 'the count comes back a few images late')
  countAs(gpu, { live: 5, queued: 4 })
  probes.submitted()
  await landed()
  assert.equal(probes.lastProbes, 4)
})

/** The squared distance, in cells of the level, from a cell to the one the eye is in. */
const cellsFrom = (spacing: number, eye: number[], cell: number[]) =>
  cell.reduce((sum, c, axis) => sum + (c - Math.floor(eye[axis] / spacing)) ** 2, 0)

test('the probes that hold nothing fill before any refresh: finest level first, nearest cells first', () => {
  const eye = [100, 5, 100]
  const { cascades, pool, read } = cityPool(eye)
  read()
  const spacing = cascades.levels[0].spacing
  // A budget of ten probes: the cells that hold nothing are not throttled by it, the queue is.
  const queued = pool.image({ rank: 2, eye, marking: true, budget: 10 })
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
  for (let dz = -CITY_REACH; dz <= CITY_REACH; dz++)
    for (let dy = -CITY_REACH; dy <= CITY_REACH; dy++)
      for (let dx = -CITY_REACH; dx <= CITY_REACH; dx++) {
        const cell = eye.map((v, axis) => Math.floor(v / spacing) + [dx, dy, dz][axis])
        if (!taken.has(cell.join()) && whole(cellsFrom(spacing, eye, cell)) < farthest) leftNearer++
      }
  assert.equal(leftNearer, 0, 'never a farther cell before a nearer one')
  assert.equal(Math.min(...away), 0, 'the cell the eye is in comes with them')
  // Run on, the cells fill and the count of those left falls to zero. A pass queues a refresh only
  // once no cell is left that holds nothing: a probe already filled is refreshed after every empty one.
  for (let rank = 3; pool.tally().unfilled > 0; rank++) {
    assert.ok(rank < 100, 'the cells fill')
    const sent = pool.image({ rank, eye, marking: false, budget: 10 })
    if (sent.some((entry) => !entry.fresh))
      assert.equal(pool.tally().unfilled, 0, 'no refresh before a cell that holds nothing')
  }
  // Filled, the frame holds to the budget again.
  assert.ok(pool.image({ rank: 100, eye, marking: false, budget: 10 }).length <= 10)
})

test('an eye that jumps leaves the cells it lands among empty, and they fill nearest first', () => {
  const eye = [100, 5, 100]
  const { cascades, pool, read } = cityPool(eye)
  read()
  pool.image({ rank: 2, eye, marking: true, budget: 10 })
  for (let rank = 3; pool.tally().unfilled > 0; rank++)
    pool.image({ rank, eye, marking: false, budget: 10 })
  const landed = [30, 8, 160]
  assert.equal(cascades.follow(landed), true)
  // The cells the old eye read are mostly out of the finest level now: given back as the levels slid, and the new ones read.
  for (let level = 0; level < 2; level++) {
    const spacing = cascades.levels[level].spacing
    const at = landed.map((v) => Math.floor(v / spacing))
    for (let dz = -CITY_REACH; dz <= CITY_REACH; dz++)
      for (let dy = -CITY_REACH; dy <= CITY_REACH; dy++)
        for (let dx = -CITY_REACH; dx <= CITY_REACH; dx++)
          pool.mark(level, at[0] + dx, at[1] + dy, at[2] + dz)
  }
  const queued = pool.image({ rank: 40, eye: landed, marking: true, slid: true, budget: 10 })
  assert.ok(
    pool.tally().live < 2 * 2 * (2 * CITY_REACH + 1) ** 3,
    'the cells that left are given back',
  )
  assert.ok(pool.tally().unfilled >= 0)
  const spacing = cascades.levels[0].spacing
  const away = queued.map((entry) => cellsFrom(spacing, landed, entry.cell))
  assert.equal(Math.min(...away), 0)
  assert.ok(
    queued.every((entry) => entry.fresh),
    'what holds nothing before any refresh',
  )
  for (let rank = 41; pool.tally().unfilled > 0; rank++) {
    assert.ok(rank < 200, 'the cells fill again')
    pool.image({ rank, eye: landed, marking: false, budget: 10 })
  }
  assert.equal(pool.tally().unfilled, 0)
})

test('the cells an image reads are marked by its pass, their probes counted on the GPU, and the series stays open until the count came back', async () => {
  const floor = await floorProbes(false)
  const { gpu, probes, encoder } = floor
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
  // Nothing is counted yet: the pool holds no probe, the series has none to trace, yet it is open.
  assert.equal(probes.stats.live, 0)
  assert.equal(
    encodeImage(probes, encoder, 1, FLOOR_EYE, FLOOR_SKY, FLOOR_READS, surface),
    true,
    'the image marks',
  )
  const marked = gpu.commands.filter((command) => command === 'clear' || command === 'copy')
  assert.deepEqual(
    marked,
    ['clear', 'copy'],
    "the bitmap cleared, the pass, the pool's statistics copied",
  )
  assert.ok(
    gpu.dispatches.some((dispatch) => dispatch.entryPoint === 'markImage'),
    'the pass marks the cells the image draws',
  )
  assert.equal(probes.lastProbes, 0, 'no probe to trace before a cell is read')
  assert.equal(probes.working, true, 'marks owed and in flight')
  // The same view marks again, a jitter on: `markJitter` marks, then none.
  await closeSeries(floor, { live: 1 }, surface)
  assert.equal(probes.stats.live, 1, 'the cell the image read holds a probe')
  assert.equal(probes.stats.unfilled, 0)
  assert.ok(gpu.dispatches.length > 0)
  // Closed, a still view marked in full costs nothing more.
  const writes = gpu.writes.length,
    commands = gpu.commands.length
  assert.equal(encodeImage(probes, encoder, 1, FLOOR_EYE, FLOOR_SKY, FLOOR_READS, surface), false)
  assert.equal(gpu.writes.length, writes)
  assert.equal(gpu.commands.length, commands)
  assert.ok(BOUNCE_SETTINGS.markJitter >= 1)
  // The view stands still but what it draws changed — the cut refined, pages arrived —: the cells of
  // the surfaces it now shows were never marked, so the image marks again, `markJitter` marks, then none.
  surface.signature[36] += 1
  assert.equal(
    encodeImage(probes, encoder, 1, FLOOR_EYE, FLOOR_SKY, FLOOR_READS, surface),
    true,
    'a changed cut marks again',
  )
  assert.equal(probes.working, true, 'marks owed and in flight')
  await closeSeries(floor, { live: 1 }, surface)
  assert.equal(
    encodeImage(probes, encoder, 1, FLOOR_EYE, FLOOR_SKY, FLOOR_READS, surface),
    false,
    'then a still image marks nothing',
  )
})

test('an image that cast screen probes marks the cells from their points, not from the pixels it drew', async () => {
  const floor = await floorProbes(false)
  const { gpu, probes, encoder } = floor
  const view = (format: GPUTextureFormat) =>
    gpu.device
      .createTexture({ size: [8, 8, 1], format, usage: GPUTextureUsage.TEXTURE_BINDING })
      .createView()
  const surface = createMarkSurface()
  surface.depth = view('depth32float')
  surface.normals = view('rgba16float')
  surface.view = gpu.device.createBuffer({ size: 256, usage: GPUBufferUsage.UNIFORM })
  surface.size = [64, 64]
  surface.probes = {
    info: view('rgba32float'),
    normal: view('rgba32float'),
    counts: gpu.device.createBuffer({ size: 4, usage: GPUBufferUsage.STORAGE }),
    uniform: 16,
    maxAdaptive: 4,
    tilesX: 8,
    rows: 3,
  }
  assert.equal(encodeImage(probes, encoder, 1, FLOOR_EYE, FLOOR_SKY, FLOOR_READS, surface), true)
  const entries = gpu.dispatches.map((dispatch) => dispatch.entryPoint)
  assert.ok(entries.includes('markProbes'))
  assert.ok(!entries.includes('markImage'))
})

test('a closed series finds work again when a level that casts is chosen: the radiance cache is made, every probe is traced anew; given back where no screen probe reads it', async () => {
  let level: 'low' | 'ultra' = 'low'
  const floor = await floorProbes(true, () => screenProbeSettings({ screenProbes: level }))
  const { probes, encoder } = floor
  probes.restart()
  await closeSeries(floor, { live: 3 })
  assert.equal(probes.cache.views, undefined, 'a level that casts none keeps no maps')
  assert.equal(encodeImage(probes, encoder, 1, FLOOR_EYE, FLOOR_SKY, FLOOR_READS), false, 'closed')
  level = 'ultra'
  assert.equal(
    encodeImage(probes, encoder, 1, FLOOR_EYE, FLOOR_SKY, FLOOR_READS),
    true,
    'the maps are made: every probe is traced anew',
  )
  assert.ok(probes.cache.views && probes.cache.bytes > 0)
  assert.equal(probes.cache.pending, true)
  await closeSeries(floor, { live: 3 })
  level = 'low'
  assert.equal(encodeImage(probes, encoder, 1, FLOOR_EYE, FLOOR_SKY, FLOOR_READS), false)
  assert.equal(probes.cache.views, undefined, 'given back')
  probes.dispose()
})
