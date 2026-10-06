// #849, #1369: the view's light-index pool of the grid's lists, as the frame metrics carry it. A
// sampled frame whose pool overflowed is named and grows the pool to 1.25 × what it reserved,
// within a bound per column of cells.
import test from 'node:test'
import assert from 'node:assert/strict'
import { LIGHT_SETTINGS } from '../../../../sdk-core/src/index.ts'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { createGpuLightTiles } from './tiles.ts'
import { TILE_STRIDE_WORDS } from '../direct/lightWgsl.ts'
import { shippedColumn, suns } from './gridColumn.fixture.ts'
import { random } from '../../page/cut/cutRuleChecks.fixture.ts'

/** 160 × 160 pixels: 3 × 3 columns of cells. */
const COLUMNS = Math.ceil(160 / LIGHT_SETTINGS.tileSize) ** 2
const START = COLUMNS * LIGHT_SETTINGS.tileLights * 16,
  MOST = START * 16,
  /** Where the pool starts: the cell records, each `TILE_STRIDE_WORDS` wide. */
  RECORDS = COLUMNS * LIGHT_SETTINGS.gridSlices * TILE_STRIDE_WORDS

test('the frame metrics carry the sampled pool and count its growths', async () => {
  const fake = fakeDevice()
  Object.assign(fake.device, { features: new Set() })
  const tiles = await createGpuLightTiles(fake.device)
  const pass = { setPipeline() {}, setBindGroup() {}, dispatchWorkgroups() {}, end() {} }
  const encoder = { ...fake.device.createCommandEncoder(), beginComputePass: () => pass }
  const readback = fake.buffers.find((buffer) => buffer.label?.includes('pool readback'))!
  const state = fake.buffers.find((buffer) => buffer.label?.includes('pool v1'))!
  const pools = () => fake.writes.filter((write) => write.buffer === (state as never))
  /** One frame of 160 × 160 pixels, the GPU's pool state `words`. */
  const frame = async (at: number, words?: number[]) => {
    tiles.ensure(160, 160, fake.buffers[0] as never, LIGHT_SETTINGS.tileLights)
    tiles.update(new Float64Array(16), [0, 0, 0], 160, 160)
    tiles.encode(encoder as unknown as GPUCommandEncoder, at)
    if (words) new Uint32Array(readback.getMappedRange()).set(words)
    tiles.submitted()
    await new Promise((settled) => setTimeout(settled))
    return tiles.poolMetrics()
  }
  // A view names nothing before a sample returns; the frame opens its pool, nothing reserved.
  tiles.ensure(160, 160, fake.buffers[0] as never, LIGHT_SETTINGS.tileLights)
  const opened = tiles.poolMetrics()
  assert.deepEqual(opened, { ...opened, tileLightPoolOverflowed: null, tileLightPoolGrowths: 0 })
  const asked = START + 1000,
    grown = Math.ceil(asked * 1.25)
  await frame(0, [RECORDS, START, asked, 1])
  assert.deepEqual([...pools()[0].data], [RECORDS, START, 0, 0])
  // Grown to 1.25 × what it reserved: a demand risen by less finds room, and no growth follows.
  const risen = Object.values(await frame(15, [RECORDS, grown, asked + 500, 0]))
  assert.deepEqual(risen, [asked + 500, grown, false, 1], 'reserved, capacity, overflowed, growths')
  await frame(30, [RECORDS, grown, MOST * 3, 1])
  // Then grown to its bound.
  assert.equal((await frame(45)).tileLightPoolGrowths, 2)
  const capacities = pools().map((write) => write.data[1])
  assert.deepEqual(capacities, [START, grown, grown, MOST])
})

// S23.1: a column lists each light at most once in each slice, so `gridSlices × lights` words hold
// its lists whole: a view of fewer lights than START allows starts at that bound, overflow-free.
/** The pool words a view of `width × height` pixels allocates for `lights` lights. */
async function poolOf(width: number, height: number, lights: number) {
  const fake = fakeDevice()
  const tiles = await createGpuLightTiles(fake.device)
  tiles.ensure(width, height, fake.buffers[0] as never, lights)
  const columns = Math.ceil(width / CELL) * Math.ceil(height / CELL)
  return tiles.buffer!.size / 4 - columns * SLICES * TILE_STRIDE_WORDS
}
const CELL = LIGHT_SETTINGS.tileSize,
  SLICES = LIGHT_SETTINGS.gridSlices

test('the pool starts at its true bound: a slice of words per light and column, START at most', async () => {
  const per = [0, 1, 2, 3, 4, 64].map((lights) => poolOf(CELL, CELL, lights))
  assert.deepEqual(await Promise.all(per), [256, 256, 512, 768, 1024, 1024])
  // One light saves 768 words a column: 1.57, 2.83 and 6.27 MB at 1080p, 1440p and 2160p.
  const saved = async ([width, height]: number[]) =>
    ((await poolOf(width, height, 4)) - (await poolOf(width, height, 1))) * 4
  const sizes = [
    [1920, 1080],
    [2560, 1440],
    [3840, 2160],
  ]
  assert.deepEqual(await Promise.all(sizes.map(saved)), [1_566_720, 2_826_240, 6_266_880])
})

test('a column of lights holding every slice fills that bound exactly; one word less overflows', async () => {
  for (const lights of [1, 2, 3, 4]) {
    const exact = { start: 0, capacity: await poolOf(CELL, CELL, lights), head: 0, overflow: 0 }
    shippedColumn(suns(lights), exact)
    assert.deepEqual([exact.head, exact.overflow], [SLICES * lights, 0], `${lights}`)
    const short = { start: 0, capacity: SLICES * lights - 1, head: 0, overflow: 0 }
    shippedColumn(suns(lights), short)
    assert.equal(short.overflow, 1)
  }
  // Random columns of a view sharing its pool: none overflows.
  for (let seed = 1; seed <= 12; seed++) {
    const r = random(seed),
      lights = 1 + Math.floor(r() * 3),
      columns = 8
    const capacity = await poolOf(columns * CELL, CELL, lights)
    const pool = { start: 0, capacity, head: 0, overflow: 0 }
    for (let column = 0; column < columns; column++) {
      const runs = Array.from({ length: lights }, () => {
        const first = Math.floor(r() * SLICES)
        return { first, last: first + Math.floor(r() * (SLICES - first)), slot: false }
      })
      shippedColumn(runs, pool)
    }
    assert.equal(pool.overflow, 0, `seed ${seed}`)
  }
})
