// The view's light-index pool of the grid's lists, as the frame metrics carry it: FIXED, its cells
// times the words a cell holds. A sampled frame whose pool overflowed is named, and the pool stays.
import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
import { LIGHT_SETTINGS } from '../../../../sdk-core/src/scene/light/contracts.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { createGpuLightTiles } from './tiles.ts'
import { GRID_HEAD_WORDS, TILE_STRIDE_WORDS } from '../direct/lightWgsl.ts'
import { openPool, shippedColumn, suns } from './gridColumn.fixture.ts'
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { lcgRandom } from '../../../../math/src/sequence/random.ts'

/** 160 × 160 pixels: 3 × 3 columns of cells. */
const COLUMNS = ceilDiv(160, LIGHT_SETTINGS.tileSize) ** 2
/** The words a cell holds: the setting `lightGridMaxCulledLightsPerCell`'s default. */
const PER_CELL = 32
const POOL = COLUMNS * LIGHT_SETTINGS.gridSlices * PER_CELL,
  /** Where the pool starts: the slice map, then the cell records, each `TILE_STRIDE_WORDS` wide. */
  RECORDS = GRID_HEAD_WORDS + COLUMNS * LIGHT_SETTINGS.gridSlices * TILE_STRIDE_WORDS

/** The scene's light list the grid reads: a storage buffer, as the pass binds it. */
const lightList = (device: GPUDevice) =>
  device.createBuffer({ label: 'lights', size: 256, usage: GPUBufferUsage.STORAGE })

test('the frame metrics carry the sampled pool, fixed at its cells times the words a cell holds', async () => {
  const fake = fakeDevice()
  Object.assign(fake.device, { features: new Set() })
  const tiles = await createGpuLightTiles(fake.device)
  const lights = lightList(fake.device)
  const encoder = fake.device.createCommandEncoder()
  const readback = fake.buffers.find((buffer) => buffer.label?.includes('pool readback'))!
  const state = fake.buffers.find((buffer) => buffer.label?.includes('pool v1'))!
  const pools = () => fake.writes.filter((write) => write.buffer === (state as never))
  /** One frame of 160 × 160 pixels, the GPU's pool state `words`. */
  const frame = async (at: number, words?: number[]) => {
    tiles.ensure(160, 160, lights, PER_CELL, true)
    tiles.update(new Float64Array(16), [0, 0, 0], 160, 160, {
      depth: undefined,
      words: new Float32Array(8),
      map: new Float32Array(GRID_HEAD_WORDS),
    })
    tiles.encode(encoder, at)
    if (words) new Uint32Array(readback.getMappedRange()).set(words)
    tiles.submitted()
    await new Promise((settled) => setTimeout(settled))
    return tiles.poolMetrics()
  }
  // A view names nothing before a sample returns; the frame opens its pool, nothing reserved.
  tiles.ensure(160, 160, lights, PER_CELL, true)
  const opened = tiles.poolMetrics()
  assert.deepEqual(opened, { ...opened, tileLightPoolOverflowed: null })
  const asked = POOL + 1000
  const overflowed = Object.values(await frame(0, [RECORDS, POOL, asked, POOL]))
  assert.deepEqual(overflowed, [asked, POOL, true], 'reserved, capacity, overflowed')
  assert.deepEqual([...pools()[0].data], [RECORDS, POOL, 0, 0])
  // The demand risen again: the pool stays what it was.
  await frame(15, [RECORDS, POOL, asked * 2, POOL])
  await frame(30)
  assert.deepEqual(
    pools().map((write) => write.data[1]),
    [POOL, POOL, POOL],
  )
})

// A column lists each light at most once in each slice,
// and a column that needs more than its share drops the lights past it.
/** The pool words a view of `width × height` pixels allocates. */
async function poolOf(width: number, height: number) {
  const fake = fakeDevice()
  const tiles = await createGpuLightTiles(fake.device)
  tiles.ensure(width, height, lightList(fake.device), PER_CELL, true)
  const columns = ceilDiv(width, CELL) * ceilDiv(height, CELL)
  return tiles.buffer!.size / 4 - GRID_HEAD_WORDS - columns * SLICES * TILE_STRIDE_WORDS
}
const CELL = LIGHT_SETTINGS.tileSize,
  SLICES = LIGHT_SETTINGS.gridSlices

test('the pool is a fixed number of words a cell, whatever the columns', async () => {
  assert.equal(await poolOf(CELL, CELL), SLICES * PER_CELL)
  assert.equal(await poolOf(3 * CELL, 2 * CELL), 6 * SLICES * PER_CELL)
})

test('a column of lights holding every slice fits its share; a pool one link short drops one', () => {
  for (const lights of [1, 2, 3, 4]) {
    const exact = openPool(SLICES * lights, 0)
    shippedColumn(suns(lights), exact)
    assert.deepEqual([exact.links, exact.head], [SLICES * lights, SLICES * lights], `${lights}`)
    const short = openPool(SLICES * lights - 1, 0)
    shippedColumn(suns(lights), short)
    // The allocator counts the link asked past the pool, which the lists do not hold.
    assert.deepEqual([short.links, short.head], [SLICES * lights, SLICES * lights - 1])
  }
})

test('random columns of a view sharing its pool: none asks past it', async () => {
  for (let seed = 1; seed <= 12; seed++) {
    const r = lcgRandom(seed),
      lights = 1 + Math.floor(r() * 3),
      columns = 8
    const capacity = await poolOf(columns * CELL, CELL)
    const pool = openPool(capacity, 0)
    for (let column = 0; column < columns; column++) {
      const runs = Array.from({ length: lights }, () => {
        const first = Math.floor(r() * SLICES)
        return { first, last: first + Math.floor(r() * (SLICES - first)), slot: false }
      })
      shippedColumn(runs, pool)
    }
    assert.ok(pool.links <= pool.capacity, `seed ${seed}`)
  }
})

test('an overflow names its cause: the setting, or the device’s limit on a buffer', async () => {
  const warned: string[] = []
  const warn = mock.method(console, 'warn', (text: string) => void warned.push(text))
  try {
    for (const bound of [false, true]) {
      const fake = fakeDevice()
      // A device that binds a buffer too small for the cells times the setting.
      if (bound)
        Object.assign(fake.device, {
          limits: { ...fake.device.limits, maxStorageBufferBindingSize: 1 << 14 },
        })
      Object.assign(fake.device, { features: new Set() })
      const tiles = await createGpuLightTiles(fake.device)
      const readback = fake.buffers.find((buffer) => buffer.label?.includes('pool readback'))!
      tiles.ensure(160, 160, lightList(fake.device), PER_CELL, true)
      tiles.update(new Float64Array(16), [0, 0, 0], 160, 160, {
        depth: undefined,
        words: new Float32Array(7),
        map: new Float32Array(GRID_HEAD_WORDS),
      })
      tiles.encode(fake.device.createCommandEncoder(), 0)
      new Uint32Array(readback.getMappedRange()).set([0, 100, 200, 100])
      tiles.submitted()
      await new Promise((settled) => setTimeout(settled))
      assert.match(warned.at(-1)!, bound ? /device binds no larger/ : /Raise lightGridMax/)
    }
  } finally {
    warn.mock.restore()
  }
})
