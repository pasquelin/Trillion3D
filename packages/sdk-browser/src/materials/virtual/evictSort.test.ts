// A tile pool's queue is cut again only when it may have moved: a pool whose queue still holds
// victims, none of whose places arrived since its cut, keeps it while no pixel stamped since, or
// while its cut is younger than a use protects. Fails on the old code: every lane pool short of a
// burst was ranked again every image a readback was free, three dispatches over all its places.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createTileEvictions } from './evictSort.ts'
import { pipelinesSettled } from '../../lighting/deferred/compileLedger.ts'
import { losslessAtlas } from './losslessAtlas.fixture.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { words } from '../../../../../tests/kit/fakeDevice/fakeBuffers.ts'
import { TILE_PROTECTED } from './evictSortWgsl.ts'
import { POOL_RANKS, POOL_TIERS } from '../../gpu/sort/rank.ts'
import { poolRank } from '../../../../../tests/kit/fakeDevice/fakeTileEvict.ts'

test('a queue that still holds victims and saw nothing move is not cut again', async () => {
  const { device } = fakeDevice()
  const atlas = losslessAtlas(device, () => 1)
  const pool = atlas.pools[0]
  for (let i = 0; pool.resident < pool.tiles; i++)
    atlas.place({ slot: 0, level: 0, tx: i % 32, ty: Math.floor(i / 32) })
  atlas.flush(device)
  const evictions = createTileEvictions(device)
  await pipelinesSettled(device) // the sort's stages, asked as the evictions are made
  /** One image at `clock`: whether its queue was cut, read back at once. */
  const image = (clock: number, stamped: boolean) => {
    const cut = evictions.encode(device.createCommandEncoder(), [atlas], clock, stamped)
    cut?.read(words((cut.buffer as unknown as { data: Uint8Array }).data))
    return cut !== undefined
  }
  // The places were used at clock 1: at the first cut they are `TILE_PROTECTED` clocks old, the
  // youngest the queue lists.
  const first = 1 + TILE_PROTECTED
  assert.equal(image(first, true), true, 'the first cut')
  assert.ok(pool.victims() > 0)
  assert.equal(image(first + 1, true), false, 'younger than a use protects')
  assert.equal(image(first + TILE_PROTECTED - 1, true), false, 'the last clock a use protects')
  assert.equal(image(first + TILE_PROTECTED, true), true, 'stamped and old enough: cut again')
  for (let clock = first + 1 + TILE_PROTECTED; clock < first + 10 + TILE_PROTECTED; clock++)
    assert.equal(image(clock, false), false, 'no stamp since: the queue names what a new one would')
  atlas.place({ slot: 0, level: 1, tx: 0, ty: 0 })
  assert.equal(image(first + 10 + TILE_PROTECTED, false), true, 'an arrival: cut again')
})

// A tile place read in the last 16 clocks is in use; past them the least recently read leaves
// first, one age step a clock, then the finer level inside a step.
test('a tile place is ranked by the exact clock of its last read once unprotected', () => {
  const rank = (age: number, tier = 0) => poolRank(age, tier, TILE_PROTECTED)
  for (let age = 0; age < TILE_PROTECTED; age++) assert.equal(rank(age), POOL_RANKS, `age ${age}`)
  const steps = Array.from({ length: 40 }, (_, i) =>
    Math.floor(rank(TILE_PROTECTED + i) / POOL_TIERS),
  )
  assert.deepEqual(
    steps.slice(0, 31),
    Array.from({ length: 31 }, (_, i) => i + 1),
  )
  assert.ok(
    steps.slice(31).every((step) => step === 31),
    'older ones share the last step',
  )
  assert.ok(rank(TILE_PROTECTED, 0) > rank(TILE_PROTECTED, 1), 'inside a step, the finer first')
  assert.ok(rank(TILE_PROTECTED + 1, 5) > rank(TILE_PROTECTED, 0), 'an older place beats a finer')
})
