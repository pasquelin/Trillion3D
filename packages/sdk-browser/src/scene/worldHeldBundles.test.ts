// The bundles past the pinned top the held cells need, told to who follows them: each bundle once
// when its first cell holds it and once when its last lets it go, those held already first.
import test from 'node:test'
import assert from 'node:assert/strict'
import { worldRootsFixture } from '../../../sdk-core/src/manifest/worldRoots.fixture.ts'
import { createHeldBundles } from './worldHeldBundles.ts'

test('a watcher is told each bundle as the cells start or stop holding it', async () => {
  // Cell 0 needs bundles 1 and 3 past the top, cell 1 bundles 2 and 3 (`worldRootsFixture`).
  const holds = createHeldBundles(worldRootsFixture().table, async () => [])
  await holds.hold(0)
  const told: [number, boolean][] = []
  const stop = holds.watch((bundle, held) => told.push([bundle, held]))
  assert.deepEqual(
    told,
    [
      [1, true],
      [3, true],
    ],
    'what is held already, first',
  )
  await holds.hold(1)
  holds.release(0)
  holds.release(1)
  assert.deepEqual(told.slice(2), [
    [2, true],
    [1, false],
    [2, false],
    [3, false],
  ])
  stop()
  await holds.hold(0)
  assert.equal(told.length, 6, 'a watcher that stopped is told nothing')
})

test('a cell is held far while the roots its unheld bundles add fit the room', async () => {
  const holds = createHeldBundles(
    worldRootsFixture().table,
    async () => [],
    (b) => b * 10,
  )
  assert.ok(holds.cover.admits(0), 'no room set: any cell')
  let room = 39
  holds.cover.room = () => room
  assert.ok(!holds.cover.admits(0), 'bundles 1 and 3 add 40')
  room = 40
  assert.ok(holds.cover.admits(0), 'asked again once the room grew')
  await holds.hold(0)
  room = 20
  assert.ok(holds.cover.admits(1), 'bundle 3 held already: bundle 2 alone')
  room = 19
  assert.ok(!holds.cover.admits(1))
  // Cell 0 lets bundle 3 go: cell 1 would add 50, still refused, the room no larger.
  holds.release(0)
  assert.ok(!holds.cover.admits(1))
})
