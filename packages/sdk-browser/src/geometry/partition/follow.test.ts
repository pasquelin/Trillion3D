// A cooked open-world cell's node casts as its host mesh says. Its rows carry the value
// (`PlacementRows.casting`), which leaves the row out of every light cut or keeps it in a sun's far
// shadows (`placement/update.test.ts`); a `castShadow` or `castFarShadow` changed after the cell
// was placed rewrites them.
import test from 'node:test'
import assert from 'node:assert/strict'
import { object } from '../../../../sdk-core/src/world/object/index.ts'
import { geometry } from '../../../../sdk-core/src/world/geometry/index.ts'
import { between, io, noBudget, opened, world } from './cells.fixture.ts'
import { createPlacementWrites, type CellFrame, type Placement } from './follow.ts'
import { createTouchedRows, placedMesh } from './rows.ts'
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import { FAR_SHADOW_ROOT, MARK_BITS, SHADOWLESS_ROOT } from '../../visibility/shader/castingMark.ts'

for (const { flag, on, bit } of [
  { flag: 'castShadow', on: false, bit: SHADOWLESS_ROOT },
  { flag: 'castFarShadow', on: true, bit: FAR_SHADOW_ROOT },
] as const)
  test(`a cell's rows cast as their host mesh says, and follow its ${flag} once changed`, async () => {
    const [plain, set] = [0, 1].map(() => object.mesh(geometry.box(1, 1, 1)))
    set[flag] = on
    const { cells, links, bytes } = world(0, null, [plain, set])
    await opened(cells, bytes, false, between)
    const casting = () => links.map((link) => [...link.placements!.casting.subarray(0, 3)])
    assert.deepEqual(casting(), [
      [0, 0, 0],
      [bit, bit, bit],
    ])
    const { port, updates } = io(bytes)
    cells.frame(between, port, noBudget)
    assert.equal(updates.length, 0, 'a still flag writes no row')
    ;[plain[flag], set[flag]] = [on, !on]
    cells.frame(between, port, noBudget)
    assert.deepEqual(casting(), [
      [bit, bit, bit],
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

test('a cell’s rows carry whether a sun’s far-shadow test reaches their host mesh, and follow it once changed', async () => {
  const meshes = [0, 1].map(() => object.mesh(geometry.box(1, 1, 1)))
  ;[meshes[0].farShadowTest, meshes[1].farShadowTest] = [true, false]
  const { cells, links, bytes } = world(0, null, meshes)
  await opened(cells, bytes, false, between)
  const casting = () => links.map((link) => link.placements!.casting[0])
  assert.deepEqual(casting(), [MARK_BITS.farTest, MARK_BITS.farSkip], 'reached, never reached')
  const { port, updates } = io(bytes)
  cells.frame(between, port, noBudget)
  assert.equal(updates.length, 0, 'a still flag writes no row')
  ;[meshes[0].farShadowTest, meshes[1].farShadowTest] = [null, true]
  cells.frame(between, port, noBudget)
  assert.deepEqual(
    casting(),
    [0, MARK_BITS.farTest],
    'each follows its mesh: as the view says, reached',
  )
})

test('the rows under a core parent follow its world on the GPU: the first rows are written and linked whole, each frame sends each parent its world alone, never a row', async () => {
  const { cells, bytes, core } = world(0, null)
  cells.pose(() => frame)
  const frame = new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
  await opened(cells, bytes, false, between)
  const calls: { parent: object; links: number; whole: boolean; world: number[] }[] = []
  const { port, updates } = io(bytes)
  port.compose = (parent, world, given, whole) =>
    void calls.push({ parent, links: given.length, whole, world: Array.from(world) })
  cells.frame(between, port, noBudget)
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
  cells.frame(between, port, noBudget)
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
  cells.frame(between, port, noBudget)
  assert.equal(calls.length, moved + 2, 'each parent sent its world: the composition decides')
  assert.equal(updates.length, sent, 'no row written')
  assert.deepEqual(
    calls
      .slice(moved)
      .map(({ links: count, world }) => [count, world[13]])
      .sort(),
    [
      [0, 0],
      [0, 20],
    ],
    'the core parent at its new world, in the frame',
  )
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
