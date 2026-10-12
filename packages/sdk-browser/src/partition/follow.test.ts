// A cooked open-world cell's node casts as its host mesh says. Its rows carry
// the flag (`PlacementRows.shadowless`), which leaves the row out of every light cut
// (`placement/update.test.ts`); a `castShadow` changed after the cell was placed rewrites them.
import test from 'node:test'
import assert from 'node:assert/strict'
import { object } from '../../../sdk-core/src/world/object/index.ts'
import { geometry } from '../../../sdk-core/src/world/geometry/index.ts'
import { io, noBudget, opened, world } from './cells.fixture.ts'

test("a cell's rows cast as their host mesh says, and follow its castShadow once changed", async () => {
  const [plain, ink] = [0, 1].map(() => object.mesh(geometry.box(1, 1, 1)))
  ink.castShadow = false
  const { cells, links, bytes } = world(0, null, [plain, ink])
  await opened(cells, bytes, 1e5, false)
  const shadowless = () => links.map((link) => [...link.placements!.shadowless.subarray(0, 3)])
  assert.deepEqual(shadowless(), [
    [0, 0, 0],
    [1, 1, 1],
  ])
  const { port, updates } = io(bytes)
  cells.frame([0, 0, 0], 1e5, port, noBudget)
  assert.equal(updates.length, 0, 'a still flag writes no row')
  ;[plain.castShadow, ink.castShadow] = [false, true]
  cells.frame([0, 0, 0], 1e5, port, noBudget)
  assert.deepEqual(shadowless(), [
    [1, 1, 1],
    [0, 0, 0],
  ])
  assert.deepEqual(
    updates.map(([rows, from, to]) => [links.findIndex((l) => l.placements === rows), from, to]),
    [
      [0, 0, 2],
      [1, 0, 2],
    ],
    'both primitives rewrite their rows, sent before the frame',
  )
})

test('a scene hung in a frame the session composes: the first move of the frame writes the rows and links them, the next ones send its world alone', async () => {
  const { cells, bytes } = world(0, null)
  const frameWorld = new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
  cells.pose(() => frameWorld)
  await opened(cells, bytes, 1e5, false)
  const calls: { links: number; whole: boolean; world: number[] }[] = []
  const { port, updates } = io(bytes)
  let accepts = true
  port.compose = (_parent, world, given, whole) => (
    accepts && calls.push({ links: given.length, whole, world: [...world] }),
    accepts
  )
  cells.frame([0, 0, 0], 1e5, port, noBudget)
  assert.equal(calls.length, 0, 'a still frame links nothing')
  frameWorld[12] = 40
  cells.frame([0, 0, 0], 1e5, port, noBudget)
  assert.deepEqual(
    calls.map(({ links: count, whole }) => [count, whole]),
    [[6, true]],
    'every row of the three nodes of both primitives, whole',
  )
  const sent = updates.length
  frameWorld[12] = 80
  cells.frame([0, 0, 0], 1e5, port, noBudget)
  assert.deepEqual(
    calls.slice(1).map(({ links: count, whole }) => [count, whole]),
    [[0, false]],
    'its world alone',
  )
  assert.equal(updates.length, sent, 'no row written')
  assert.equal(calls.at(-1)!.world[12], 80)
  accepts = false
  frameWorld[12] = 90
  cells.frame([0, 0, 0], 1e5, port, noBudget)
  assert.equal(updates.length > sent, true, 'a session that refuses: the rows are written')
})
