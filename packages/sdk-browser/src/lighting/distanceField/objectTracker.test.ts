// The placements the distance fields track carry how their root casts: a shadow unless its mark says
// none, and that they are made of clusters, which a sun's shadow maps draw (the cascade leaves them out).

import test from 'node:test'
import assert from 'node:assert/strict'
import type { MeshDistanceField } from '../../../../sdk-core/src/lighting/distanceFieldFile.ts'
import {
  MARK_BITS,
  SHADOWLESS_ROOT,
  WORLD_SPACE_ROOT,
} from '../../visibility/shader/castingMark.ts'
import type { AtlasState } from './atlasState.ts'
import { OBJECT_FLAGS as F } from './layout.ts'
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

const CASTS = F.castShadow | F.visible | F.virtualized

test('a placement casts unless its mark says it casts none, and is made of clusters whatever the mark', () => {
  assert.equal(tracked().flags(), CASTS, 'a mark of nothing')
  for (const mark of [MARK_BITS.worldRoot, MARK_BITS.movable])
    assert.equal(tracked(mark).flags(), CASTS, `the other bits are the maps’: ${mark}`)
  assert.equal(tracked(SHADOWLESS_ROOT).flags(), F.visible | F.virtualized, 'casts none')
  assert.equal(
    tracked(WORLD_SPACE_ROOT).flags(),
    F.visible | F.virtualized,
    'casts into the first-person clipmaps alone',
  )
})

test('a root whose mark changes has its placement polled again and written with its new flags', () => {
  const seen = tracked(MARK_BITS.movable)
  seen.tracker.takeUpload()
  seen.root.mark = SHADOWLESS_ROOT
  seen.tracker.sync(seen.roots, () => false, 0, 1e9)
  assert.equal(seen.flags(), F.visible | F.virtualized)
  assert.deepEqual(seen.tracker.takeUpload(), [0], 'its record is written again')
})
