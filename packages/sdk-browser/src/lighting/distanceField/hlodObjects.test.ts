// The HLOD cells' fields are placed by stand-ins for the world DAG's roots: each at its root's
// world, one for each instance of the world DAG, held only while the cut draws the cell's actor.

import test from 'node:test'
import assert from 'node:assert/strict'
import type { MeshDistanceField } from '../../../../sdk-core/src/lighting/distanceFieldFile.ts'
import { createAtlasState } from './atlasState.ts'
import { createHlodObjects, isWorldRoot, movingOf, type HlodDraws } from './hlodObjects.ts'
import { OBJECT_FLAGS as F } from './layout.ts'
import { createObjectTracker, type TrackedRoot } from './objectTracker.ts'

const box = { min: [-1, -1, -1], max: [1, 1, 1], mostlyTwoSided: false }
// A compiled mesh's field and the fields of two HLOD cells; cell 0 shares its number with mesh 0.
const meshField = { ...box, mesh: 0, hlodCell: false } as unknown as MeshDistanceField
const cellField = { ...box, mesh: 0, hlodCell: true } as unknown as MeshDistanceField
const farCell = { ...box, mesh: 3, hlodCell: true } as unknown as MeshDistanceField
const fields = [meshField, cellField, farCell]

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
type Root = { -readonly [K in keyof TrackedRoot]: TrackedRoot[K] }
const at = (x: number) => ({
  elements: Float64Array.from(IDENTITY.map((v, k) => (k === 12 ? x : v))),
})
const rootAt = (x: number, extra: Partial<Root> = {}): Root => ({ world: at(x), ...extra })
// The host's root of the world DAG carries no mark of its own: the packing adds the world's bit.
const worldRoot = (x = 0): Root => rootAt(x, { hlod: {} })

/** The actors drawing now, as `instance:cell`, and the world cells that say so. */
function drawing(...actors: [instance: number, cell: number][]) {
  const drawn = new Set(actors.map(([instance, cell]) => `${instance}:${cell}`))
  const cut = { draws: (instance, cell) => drawn.has(`${instance}:${cell}`) } satisfies HlodDraws
  return { drawn, cut }
}

function scene(roots: readonly Root[], world: HlodDraws | undefined) {
  const hlod = createHlodObjects(fields)
  const atlas = createAtlasState()
  const tracker = createObjectTracker(new Map([[0, meshField]]), atlas)
  const sync = () => {
    const joined = hlod.join(roots, world)
    tracker.sync(joined, () => false, 0, 1e9)
    return joined
  }
  sync()
  return { hlod, tracker, sync, atlas }
}

test('a world DAG’s root places the fields of the HLOD cells whose actors draw, apart from the mesh of the same number', () => {
  const { cut } = drawing([0, 0], [0, 3])
  const roots = [rootAt(0, { mesh: 0 }), worldRoot(50)]
  const { tracker, atlas } = scene(roots, cut)
  // The mesh’s placement, then the two cells’ at the world root’s place.
  assert.equal(tracker.objects.length, 3)
  assert.deepEqual(
    tracker.objects.map((entry) => entry.field),
    [meshField, cellField, farCell],
  )
  assert.equal(new Set(tracker.objects.map((entry) => entry.asset)).size, 3, 'an asset each')
  assert.equal(atlas.assets.length, 3)
  assert.deepEqual(
    tracker.objects.map((entry) => entry.world[12]),
    [0, 50, 50],
  )
  // The shells cast.
  assert.equal(tracker.sourceOf(1).flags & F.castShadow, F.castShadow)
  assert.equal(tracker.sourceOf(1).flags & F.visible, F.visible)
  assert.equal(tracker.sourceOf(1).instance, 1, 'the rank of the root it stands for')
})

test('an actor the cut does not draw holds no placement nor room in the atlas, and comes and goes as the cut draws it', () => {
  const { cut, drawn } = drawing([0, 3])
  const { tracker, sync, atlas } = scene([worldRoot()], cut)
  assert.deepEqual(
    tracker.objects.map((entry) => entry.field),
    [farCell],
    'cell 0 shows its own',
  )
  tracker.takeUpload()
  tracker.takeModified()
  // Cell 0 turns to its actor, cell 3 to its own: one placement made, one let go.
  drawn.clear()
  drawn.add('0:0')
  sync()
  assert.deepEqual(
    tracker.objects.map((entry) => entry.field),
    [cellField],
  )
  assert.deepEqual([...atlas.removed], [0], 'cell 3’s asset is freed at the next step')
  assert.deepEqual(tracker.takeUpload(), [0])
  const [stillBoxes, movingBoxes] = tracker.takeModified()
  assert.equal(stillBoxes.length + movingBoxes.length, 12, 'both boxes, six numbers each')
  // Nothing changed: nothing written.
  sync()
  assert.deepEqual(tracker.takeUpload(), [])
  // Every actor let go: no placement.
  drawn.clear()
  sync()
  assert.equal(tracker.objects.length, 0)
})

test('a stand-in follows its root’s world, and each instance of the world DAG places its own', () => {
  const { cut } = drawing([0, 0], [1, 0])
  const first = worldRoot(10)
  const { tracker, sync, hlod } = scene([first, worldRoot(10)], cut)
  // Two instances at one place, told apart: one placement each, the second’s cell 3 not drawn.
  assert.equal(tracker.objects.length, 2)
  assert.equal(hlod.count, 2)
  tracker.takeUpload()
  // The first instance moves: its placement follows, the second’s stays.
  first.world = at(70)
  first.worldAt = 1
  sync()
  assert.deepEqual(
    tracker.objects.map((entry) => entry.world[12]),
    [70, 10],
  )
  assert.deepEqual(tracker.takeUpload(), [0])
})

test('a hidden or parked root hides the stand-ins it stands for, and shows them when it is shown again', () => {
  const { cut } = drawing([0, 0])
  const root = worldRoot()
  const { tracker, sync } = scene([root], cut)
  const shown = () => tracker.sourceOf(0).flags & F.visible
  assert.equal(shown(), F.visible)
  for (const key of ['hidden', 'parked'] as const) {
    root[key] = true
    sync()
    assert.equal(shown(), 0, key)
    root[key] = false
    sync()
    assert.equal(shown(), F.visible, `${key} undone`)
  }
})

test('the stand-ins are made again only when the roots, the world cells or the actors drawn change', () => {
  const { cut, drawn } = drawing([0, 0])
  const roots = [worldRoot()]
  const hlod = createHlodObjects(fields)
  const joined = hlod.join(roots, cut)
  assert.equal(joined.length, 2)
  assert.equal(hlod.join(roots, cut), joined, 'the same list while nothing changed')
  drawn.add('0:3')
  const more = hlod.join(roots, cut)
  assert.notEqual(more, joined, 'an actor drawn more')
  assert.equal(more.length, 3)
  assert.equal(more[1].field, cellField)
  roots.push(rootAt(5, { mesh: 0 }))
  const grown = hlod.join(roots, cut)
  assert.notEqual(grown, more)
  assert.equal(grown.length, 4)
  assert.equal(grown[0], roots[0])
  roots[0] = worldRoot()
  assert.notEqual(hlod.join(roots, cut), grown, 'a world root replaced')
  // No world cells, no HLOD cell’s field, no world root, no actor drawn: the cut’s roots as they are.
  assert.equal(hlod.join(roots, undefined), roots)
  assert.equal(createHlodObjects([meshField]).join(roots, cut), roots)
  const bare = [rootAt(0, { mesh: 0 })]
  assert.equal(hlod.join(bare, cut), bare)
  drawn.clear()
  assert.equal(hlod.join(roots, cut), roots)
})

test('a stand-in moves as the root it stands for', () => {
  const { cut } = drawing([0, 0], [0, 3])
  const roots = [rootAt(0, { mesh: 0 }), worldRoot()]
  const joined = createHlodObjects(fields).join(roots, cut)
  const moving = (rank: number) => rank === 1
  assert.equal(movingOf(roots, roots, moving), moving, 'no stand-in: the cut’s own')
  const joinedMoving = movingOf(roots, joined, moving)
  assert.deepEqual(
    joined.map((_, rank) => joinedMoving(rank)),
    [false, true, true, true],
    'the mesh, the world root, then its two cells',
  )
})

test('a root is a placement of the world DAG when it carries the table of its cells', () => {
  assert.equal(isWorldRoot({ hlod: {} }), true)
  assert.equal(isWorldRoot({}), false)
  assert.equal(isWorldRoot({ hlod: undefined }), false)
})
