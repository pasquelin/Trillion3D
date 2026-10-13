// A cooked open-world cell's node casts as its host mesh says. Its rows carry
// the flag (`PlacementRows.shadowless`), which leaves the row out of every light cut
// (`placement/update.test.ts`); a `castShadow` changed after the cell was placed rewrites them.
import test from 'node:test'
import assert from 'node:assert/strict'
import { object } from '../../../sdk-core/src/world/object/index.ts'
import { geometry } from '../../../sdk-core/src/world/geometry/index.ts'
import { io, noBudget, opened, world } from './cells.fixture.ts'
import { createPlacementWrites, type CellFrame, type Placement } from './follow.ts'
import { createTouchedRows, placedMesh } from './rows.ts'
import type { Object3D } from '../../../sdk-core/src/world/object/object3d.ts'

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

test('the rows under a core parent follow its world on the GPU: the first rows are written and linked whole, the next cells linked in place, a move sends one world', async () => {
  const { cells, bytes, core } = world(0, null)
  cells.pose(() => frame)
  const frame = new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
  await opened(cells, bytes, 1e5, false)
  const calls: { parent: object; links: number; whole: boolean; world: number[] }[] = []
  const { port, updates } = io(bytes)
  port.compose = (parent, world, given, whole) =>
    void calls.push({ parent, links: given.length, whole, world: Array.from(world) })
  cells.frame([0, 0, 0], 1e5, port, noBudget)
  assert.deepEqual(
    calls.map(({ links: count, whole }) => [count, whole]).sort(),
    [
      [2, true],
      [4, true],
    ],
    'the rows of each parent, linked whole, at the session’s first frame',
  )
  assert.equal(new Set(calls.map(({ parent }) => parent)).size, 2, 'a slot a parent')
  const first = calls.length,
    sent = updates.length
  frame[12] = 40
  cells.frame([0, 0, 0], 1e5, port, noBudget)
  assert.deepEqual(
    calls.slice(first).map(({ links: count, whole, world }) => [count, whole, world[12]]),
    [
      [0, false, 40],
      [0, false, 40],
    ],
    'the frame moved: each parent’s world, no row',
  )
  assert.equal(updates.length, sent, 'no row written')
  core.position.set(0, 20, 0)
  const moved = calls.length
  cells.frame([0, 0, 0], 1e5, port, noBudget)
  assert.equal(calls.length, moved + 1, 'a core parent moved: its world alone')
  assert.equal(updates.length, sent, 'no row written')
  assert.equal(calls.at(-1)!.world[13], 20, 'its world in the frame')
})

test('a frame move reaches every slot even when a row is linked before the next follow', () => {
  const host = object.mesh(geometry.box(1, 1, 1))
  const outer = new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
  const sent = new Map<object, number[]>()
  const frame: CellFrame = {
    world: () => outer,
    compose: (parent, world) => void sent.set(parent, Array.from(world)),
  }
  const writes = createPlacementWrites(createTouchedRows(), frame)
  const [a, b] = [object.group(), object.group()]
  const placement = (parent: Object3D): Placement => ({
    mesh: placedMesh([{}], [host]),
    row: 0,
    parent,
    local: new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
  })
  const held = [[placement(a)], [placement(b)]]
  for (const [at] of held) {
    writes.write(at)
    writes.settle(held, [at.parent])
  }
  writes.follow([], held)
  const slots = [...sent.keys()]
  assert.equal(slots.length, 2, 'a slot a parent')
  // The frame moves, and a row of `a` is linked before the next follow reads the frame.
  outer[12] = 40
  const added = placement(a)
  held.push([added])
  writes.write(added)
  writes.settle(held, [a])
  sent.clear()
  writes.follow([], held)
  assert.deepEqual(
    slots.map((slot) => sent.get(slot)?.[12]),
    [40, 40],
    'both parents take the frame’s move, the one not linked again too',
  )
})
