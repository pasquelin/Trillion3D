// A tile pool's queue is cut again only when it may have moved: a pool whose queue still holds
// victims, none of whose places arrived since its cut, keeps it while no pixel stamped since, or
// while its cut is younger than a use protects. Fails on the old code: every lane pool short of a
// burst was ranked again every image a readback was free, three dispatches over all its places.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createTileEvictions } from './evictSort.ts'
import { losslessAtlas } from './losslessAtlas.fixture.ts'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { words } from '../../../../../tests/kit/gpu/fakeBuffers.ts'
import { EVICT_IN_USE } from '../../gpu/pool/rank.ts'

test('a queue that still holds victims and saw nothing move is not cut again', () => {
  const { device } = fakeDevice()
  const atlas = losslessAtlas(device, () => 1)
  const pool = atlas.pools[0]
  for (let i = 0; pool.resident < pool.tiles; i++)
    atlas.place({ slot: 0, level: 0, tx: i % 32, ty: Math.floor(i / 32) })
  atlas.flush(device)
  const evictions = createTileEvictions(device)
  /** One image at `clock`: whether its queue was cut, read back at once. */
  const image = (clock: number, stamped: boolean) => {
    const cut = evictions.encode(device.createCommandEncoder(), [atlas], clock, stamped)
    cut?.read(words((cut.buffer as unknown as { data: Uint8Array }).data))
    return cut !== undefined
  }
  assert.equal(image(10, true), true, 'the first cut')
  assert.ok(pool.victims() > 0)
  assert.equal(image(11, true), false, 'younger than a use protects')
  assert.equal(image(10 + EVICT_IN_USE, true), true, 'stamped and old enough: cut again')
  for (let clock = 13; clock < 20; clock++)
    assert.equal(image(clock, false), false, 'no stamp since: the queue names what a new one would')
  atlas.place({ slot: 0, level: 1, tx: 0, ty: 0 })
  assert.equal(image(20, false), true, 'an arrival: cut again')
})
