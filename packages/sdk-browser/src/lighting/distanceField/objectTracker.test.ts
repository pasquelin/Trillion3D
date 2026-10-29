// The placements the distance fields track carry how their root casts: a shadow unless its mark says
// none, and that they are made of clusters, which a sun's shadow maps draw (the cascade leaves them out).

import test from 'node:test'
import assert from 'node:assert/strict'
import type { MeshDistanceField } from '../../../../sdk-core/src/lighting/distanceFieldFile.ts'
import {
  MARK_BITS,
  NO_DISTANCE_FIELD_ROOT,
  SHADOWLESS_ROOT,
  WORLD_SPACE_ROOT,
} from '../../visibility/shader/castingMark.ts'
import type { AtlasState } from './atlasState.ts'
import { OBJECT_FLAGS as F } from './layout.ts'
import { cardRootVisible, rootVisible } from './objectTable.ts'
import { createObjectTracker, type TrackedRoot } from './objectTracker.ts'

const field = {
  mesh: 0,
  min: [-1, -1, -1],
  max: [1, 1, 1],
  mostlyTwoSided: false,
} as unknown as MeshDistanceField
const atlas = { reference: () => 0, release: () => undefined } as unknown as AtlasState

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
type Root = { -readonly [K in keyof TrackedRoot]: TrackedRoot[K] }

/** A tracker over one root of the given mark, and the flags it gives the placement. */
function tracked(mark?: number) {
  const tracker = createObjectTracker(new Map([[0, field]]), atlas)
  const root: Root = { mesh: 0, world: { elements: new Float64Array(IDENTITY) }, mark }
  const roots = [root]
  tracker.sync(roots, () => false, 0, 1e9)
  return { tracker, root, roots, flags: () => tracker.sourceOf(0).flags }
}

const CASTS = F.castShadow | F.visible

test('a placement casts unless its mark says it casts none', () => {
  assert.equal(tracked().flags(), CASTS, 'a mark of nothing')
  for (const mark of [MARK_BITS.worldRoot, MARK_BITS.movable])
    assert.equal(tracked(mark).flags(), CASTS, `the other bits are the maps’: ${mark}`)
  assert.equal(tracked(SHADOWLESS_ROOT).flags(), F.visible, 'casts none')
  assert.equal(
    tracked(WORLD_SPACE_ROOT).flags(),
    F.visible,
    'casts into the first-person clipmaps alone',
  )
})

test('a root that leaves the distance fields’ scene is neither shown nor casting, and enters it again with its mark', () => {
  const seen = tracked(NO_DISTANCE_FIELD_ROOT)
  assert.equal(seen.flags() & (F.visible | F.castShadow), 0, 'left out of the scene')
  seen.tracker.takeUpload()
  seen.root.mark = 0
  seen.tracker.sync(seen.roots, () => false, 0, 1e9)
  assert.equal(seen.flags() & (F.visible | F.castShadow), F.visible | F.castShadow, 'back in it')
  assert.deepEqual(seen.tracker.takeUpload(), [0], 'its record is written again')
})

test('a root left out of the distance fields’ scene keeps its cards where the rays are traced in hardware', () => {
  const root = {
    mesh: 0,
    world: { elements: new Float64Array(IDENTITY) },
    mark: NO_DISTANCE_FIELD_ROOT,
  }
  assert.deepEqual(
    [rootVisible(root), cardRootVisible(root, false), cardRootVisible(root, true)],
    [false, false, true],
  )
  assert.equal(cardRootVisible({ ...root, hidden: true }, true), false, 'a hidden root has none')
})

test('a root whose mark changes has its placement polled again and written with its new flags', () => {
  const seen = tracked(MARK_BITS.movable)
  seen.tracker.takeUpload()
  seen.root.mark = SHADOWLESS_ROOT
  seen.tracker.sync(seen.roots, () => false, 0, 1e9)
  assert.equal(seen.flags(), F.visible)
  assert.deepEqual(seen.tracker.takeUpload(), [0], 'its record is written again')
})

test('a hidden root still casts, a parked one casts none, and a hidden root that is then parked is written again', () => {
  const seen = tracked()
  seen.root.hidden = true
  seen.tracker.sync(seen.roots, () => false, 0, 1e9)
  assert.equal(seen.flags(), F.castShadow, 'hidden: still casts')
  seen.tracker.takeUpload()
  seen.root.parked = true
  seen.tracker.sync(seen.roots, () => false, 0, 1e9)
  assert.equal(seen.flags(), 0, 'parked: casts none')
  assert.deepEqual(seen.tracker.takeUpload(), [0], 'its record is written again')
})

test('a root cut at run time is placed as the field built for it, once there is one', () => {
  const built = { ...field, mesh: -1 } as MeshDistanceField
  let given: MeshDistanceField | undefined
  const tracker = createObjectTracker(new Map(), atlas, () => given)
  const root: Root = { runtime: true, world: { elements: new Float64Array(IDENTITY) } }
  const roots = [root]
  tracker.sync(roots, () => false, 0, 1e9)
  assert.equal(tracker.objects.length, 0, 'none while its field is built')
  given = built
  tracker.sync(roots, () => false, 0, 1e9)
  assert.equal(tracker.objects.length, 0, 'the roots are read again when the epoch moves')
  tracker.sync(roots, () => false, 1, 1e9)
  assert.equal(tracker.objects.length, 1)
  assert.equal(tracker.sourceOf(0).field, built)
  given = undefined
  tracker.sync(roots, () => false, 2, 1e9)
  assert.equal(tracker.objects.length, 0, 'gone when its field is')
})

test('a compiled mesh keeps its compiled field whatever the run-time resolver says', () => {
  const tracker = createObjectTracker(
    new Map([[0, field]]),
    atlas,
    () => ({ ...field, mesh: -1 }) as MeshDistanceField,
  )
  tracker.sync([{ mesh: 0, world: { elements: new Float64Array(IDENTITY) } }], () => false, 0, 1e9)
  assert.equal(tracker.sourceOf(0).field, field)
})
