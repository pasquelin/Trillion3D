// `hold.ts` lets a frame hold once the bounce series has closed (`working` false): the pass that kept the frame of the last change is
// counted and no probe is short of a trace since, so a held frame reads the light the probes hold. Every image that is drawn marks the cells it
// reads and runs the pass (`probeEncode.ts`), as the reference marks and updates its cache every frame. Driven here on the engine's own
// probes, over a recording device; the pool's own choices (which cells hold a probe, which probes are traced first) on its kernels run as
// JavaScript.

import test from 'node:test'
import assert from 'node:assert/strict'
import { FLOOR_SKY, FLOOR_EYE, FLOOR_READS, floorProbes } from './floorProbes.fixture.ts'
import { screenProbeSettings } from '../../../../sdk-core/src/bounce/screenProbeOptions.fixture.ts'
import { createMarkSurface } from './pool/pool.ts'
import { POOL_WORK } from './pool/poolLayout.ts'

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

type EncodeArgs = Parameters<Floor['probes']['encode']>

/** An image's probe pass as the frame encodes it: the viewpoint taken (`track`), then the pass, the light kept as it is (pre-exposure one). */
const encodeImage = (
  probes: Floor['probes'],
  encoder: EncodeArgs[0],
  viewpoint: EncodeArgs[1],
  sky: EncodeArgs[2],
  reads: EncodeArgs[3],
  surface?: EncodeArgs[5],
) => (probes.track(viewpoint, 1), probes.encode(encoder, viewpoint, sky, reads, 1, surface))

/** Encodes images until the series closes, the statistics of each coming back before the next (`counted`: the GPU's count of the probes). */
async function closeSeries(floor: Floor, counted: { live: number }, surface?: EncodeArgs[5]) {
  const { gpu, probes, encoder } = floor
  for (let frames = 0; probes.working; frames++) {
    assert.ok(frames < 1000, 'the series closes')
    encodeImage(probes, encoder, FLOOR_EYE, FLOOR_SKY, FLOOR_READS, surface)
    countAs(gpu, counted)
    probes.submitted()
    await landed()
  }
}

test('the series closes once the pass of the last change is counted and no probe is short of a trace; a drawn image still runs the pass', async () => {
  const floor = await floorProbes()
  const { gpu, probes, encoder } = floor
  // The lights changed: every probe is to be traced since, and the series is open till the pass's count came back.
  probes.restart()
  assert.equal(probes.working, true)
  await closeSeries(floor, { live: 12 })
  assert.ok(gpu.dispatches.length > 0, 'the series traced probes before it closed')
  assert.equal(probes.working, false)
  assert.equal(probes.stats.unfilled, 0, 'a closed series holds light in every probe it keeps')
  assert.equal(probes.stats.live, 12, 'and keeps probes')
  // An image drawn at rest marks and traces as every image does, and opens nothing: the reference updates its cache every frame.
  const dispatched = gpu.dispatches.length
  encodeImage(probes, encoder, FLOOR_EYE, FLOOR_SKY, FLOOR_READS)
  assert.ok(gpu.dispatches.length > dispatched, 'the pass runs')
  assert.equal(probes.working, false)
})

test('a restart not yet encoded keeps the series open, and so does a probe the pass counted short of a trace', async () => {
  const floor = await floorProbes()
  const { gpu, probes, encoder } = floor
  probes.restart()
  await closeSeries(floor, { live: 3 })
  assert.equal(probes.working, false)
  probes.restart()
  assert.equal(probes.working, true, 'the lights changed: the probes are to be traced anew')
  encodeImage(probes, encoder, FLOOR_EYE, FLOOR_SKY, FLOOR_READS)
  assert.equal(
    probes.working,
    true,
    'the pass that kept the frame of the change is not counted yet',
  )
  countAs(gpu, { live: 3, refreshing: 3 })
  probes.submitted()
  await landed()
  assert.equal(probes.working, true, 'and the probes the pass counted are short of a trace')
  await closeSeries(floor, { live: 3 })
  assert.equal(probes.working, false)
})

test('a discard of the cache the probes hold opens the series like a restart', async () => {
  const floor = await floorProbes(false)
  const { probes } = floor
  assert.equal(probes.working, false)
  probes.discard()
  assert.equal(
    probes.working,
    true,
    'the next pass is a full update, and counted before the series may close',
  )
  await closeSeries(floor, { live: 3 })
  assert.equal(probes.working, false)
})

test("the probes the pass queued are the GPU's to count: every dispatch over them is indirect, from the arguments the pass wrote", async () => {
  const floor = await floorProbes()
  const { gpu, probes, encoder } = floor
  probes.restart()
  encodeImage(probes, encoder, FLOOR_EYE, FLOOR_SKY, FLOOR_READS)
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

test('the pool clears the indirection, marks the cells, puts the probes back, then clears its counters, allocates, chooses, writes the queue, tallies and publishes', async () => {
  const floor = await floorProbes(false)
  const { gpu, probes, encoder } = floor
  probes.restart()
  const surface = createMarkSurface()
  surface.depth = gpu.device
    .createTexture({
      size: [64, 64, 1],
      format: 'depth32float',
      usage: GPUTextureUsage.TEXTURE_BINDING,
    })
    .createView()
  surface.view = gpu.device.createBuffer({ size: 256, usage: GPUBufferUsage.UNIFORM })
  surface.size = [64, 64]
  encodeImage(probes, encoder, FLOOR_EYE, FLOOR_SKY, FLOOR_READS, surface)
  const pool = new Set([
    'clearIndirection',
    'markImage',
    'sizeSlots',
    'updateProbes',
    'clearWork',
    'stampChange',
    'allocateProbes',
    'countProbes',
    'cutProbes',
    'emitProbes',
    'finishQueue',
    'tallyProbes',
    'publishTable',
  ])
  assert.deepEqual(
    gpu.dispatches.map((dispatch) => dispatch.entryPoint ?? '').filter((entry) => pool.has(entry)),
    [
      'clearIndirection',
      'markImage',
      'sizeSlots',
      'updateProbes',
      'clearWork',
      'stampChange',
      'allocateProbes',
      'sizeSlots',
      'countProbes',
      'cutProbes',
      'emitProbes',
      'finishQueue',
      'tallyProbes',
      'publishTable',
    ],
  )
})

test('every image marks the cells it reads in a pass of its own, their probes counted on the GPU', async () => {
  const floor = await floorProbes(false)
  const { gpu, probes, encoder } = floor
  const texture = (format: GPUTextureFormat) =>
    gpu.device
      .createTexture({ size: [64, 64, 1], format, usage: GPUTextureUsage.TEXTURE_BINDING })
      .createView()
  const surface = createMarkSurface()
  surface.depth = texture('depth32float')
  surface.view = gpu.device.createBuffer({ size: 256, usage: GPUBufferUsage.UNIFORM })
  surface.size = [64, 64]
  // Nothing is counted yet: the pool holds no probe.
  assert.equal(probes.stats.live, 0)
  encodeImage(probes, encoder, FLOOR_EYE, FLOOR_SKY, FLOOR_READS, surface)
  const marked = gpu.commands.filter((command) => command === 'clear' || command === 'copy')
  assert.deepEqual(
    marked,
    ['clear', 'copy'],
    "the bitmap cleared, the pass, the pool's statistics copied",
  )
  const marks = () => gpu.dispatches.filter((dispatch) => dispatch.entryPoint === 'markImage')
  assert.equal(marks().length, 1, 'the pass marks the cells the image draws')
  assert.equal(probes.lastProbes, 0, 'no probe to trace before a cell is read')
  countAs(gpu, { live: 1 })
  probes.submitted()
  await landed()
  assert.equal(probes.stats.live, 1, 'the cell the image read holds a probe')
  assert.equal(probes.stats.unfilled, 0)
  // The same view, nothing changed, marks again: the reference marks every frame.
  encodeImage(probes, encoder, FLOOR_EYE, FLOOR_SKY, FLOOR_READS, surface)
  assert.equal(marks().length, 2)
  assert.deepEqual(
    gpu.commands.filter((command) => command === 'clear'),
    ['clear', 'clear'],
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
  surface.view = gpu.device.createBuffer({ size: 256, usage: GPUBufferUsage.UNIFORM })
  surface.size = [64, 64]
  surface.probes = {
    info: view('rgba32float'),
    counts: gpu.device.createBuffer({ size: 4, usage: GPUBufferUsage.STORAGE }),
    uniform: 16,
    maxAdaptive: 4,
    tilesX: 8,
    rows: 3,
  }
  encodeImage(probes, encoder, FLOOR_EYE, FLOOR_SKY, FLOOR_READS, surface)
  const entries = gpu.dispatches.map((dispatch) => dispatch.entryPoint)
  assert.ok(entries.includes('markProbes'))
  assert.ok(!entries.includes('markImage'))
})

test('a closed series finds work again when a level that casts is chosen: the radiance cache is made, every probe is traced anew; given back where no screen probe reads it', async () => {
  let level: 'off' | 'ultra' = 'off'
  const floor = await floorProbes(true, () => screenProbeSettings({ screenProbes: level }))
  const { probes, encoder } = floor
  probes.restart()
  await closeSeries(floor, { live: 3 })
  assert.equal(probes.cache.views, undefined, 'a level that casts none keeps no maps')
  assert.equal(probes.working, false, 'closed')
  level = 'ultra'
  encodeImage(probes, encoder, FLOOR_EYE, FLOOR_SKY, FLOOR_READS)
  assert.equal(probes.working, true, 'the maps are made: every probe is traced anew')
  assert.ok(probes.cache.views && probes.cache.bytes > 0)
  assert.equal(probes.cache.pending, true)
  await closeSeries(floor, { live: 3 })
  level = 'off'
  probes.track(FLOOR_EYE, 1)
  assert.equal(probes.cache.views, undefined, 'given back')
  probes.dispose()
})

test('a change of the pre-exposure the light is cached under is taken before the image’s pass: the maps are made again and the series opens at once, so that the pass is the full update and the table never names a map the update leaves empty', async () => {
  const floor = await floorProbes(true, () => screenProbeSettings({ screenProbes: 'ultra' }))
  const { probes, encoder } = floor
  probes.restart()
  await closeSeries(floor, { live: 3 })
  assert.equal(probes.working, false, 'closed')
  const made = probes.cache.views?.raw
  assert.ok(made)
  probes.track(FLOOR_EYE, 1)
  assert.equal(probes.cache.views?.raw, made, 'the same pre-exposure keeps the maps')
  assert.equal(probes.working, false)
  probes.track(FLOOR_EYE, 2)
  assert.notEqual(probes.cache.views?.raw, made, 'the maps are made again')
  assert.equal(
    probes.working,
    true,
    'the series opens before the image’s pass, which is the full update',
  )
  probes.encode(encoder, FLOOR_EYE, FLOOR_SKY, FLOOR_READS, 2)
  assert.equal(probes.cache.pending, true)
  probes.dispose()
})
