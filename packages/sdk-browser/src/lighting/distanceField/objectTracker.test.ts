// The placements the distance fields track carry how their root casts: whether the sun's far-shadow test
// reaches them, which the sun's distance-field cascade shadows what the shadow maps leave out by.

import test from 'node:test'
import assert from 'node:assert/strict'
import type { MeshDistanceField } from '../../../../sdk-core/src/lighting/distanceFieldFile.ts'
import { FAR_SHADOW_ROOT, MARK_BITS, SHADOWLESS_ROOT } from '../../visibility/shader/castingMark.ts'
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

test('a placement casts unless its mark says it casts none, and the far-shadow test reaches it as its mark says', () => {
  assert.equal(
    tracked().flags(),
    CASTS | F.farTestable,
    'a mark of nothing: the view’s rule decides',
  )
  assert.equal(tracked(MARK_BITS.farTest).flags(), CASTS | F.farTestable | F.farTested)
  assert.equal(
    tracked(MARK_BITS.worldRoot).flags(),
    CASTS | F.farTestable | F.farTested,
    'the world’s shells',
  )
  assert.equal(tracked(MARK_BITS.farSkip).flags(), CASTS, 'never reached')
  assert.equal(
    tracked(MARK_BITS.farTest | MARK_BITS.farSkip).flags(),
    CASTS,
    'never, whatever else it says',
  )
  assert.equal(tracked(FAR_SHADOW_ROOT).flags(), CASTS | F.farTestable | F.castsFar)
  assert.equal(
    tracked(SHADOWLESS_ROOT).flags(),
    F.visible | F.virtualized | F.farTestable,
    'casts none',
  )
})

test('the placements the cascade shadows whatever the view says are counted as they come, change and go', () => {
  const seen = tracked(MARK_BITS.farTest)
  assert.equal(seen.tracker.farShadowObjects, 1)
  for (const mark of [
    undefined,
    FAR_SHADOW_ROOT | MARK_BITS.farTest,
    SHADOWLESS_ROOT | MARK_BITS.farTest,
  ])
    assert.equal(tracked(mark).tracker.farShadowObjects, 0, `${mark}`)
  // The root's mark changes: the placement is polled again and written with its new flags.
  seen.root.mark = FAR_SHADOW_ROOT | MARK_BITS.farTest
  seen.tracker.sync(seen.roots, () => false, 0, 1e9)
  assert.equal(seen.tracker.farShadowObjects, 0)
  assert.equal(seen.flags() & F.castsFar, F.castsFar)
  seen.root.mark = MARK_BITS.worldRoot
  seen.tracker.sync(seen.roots, () => false, 0, 1e9)
  assert.equal(seen.tracker.farShadowObjects, 1)
  assert.deepEqual(seen.tracker.takeUpload(), [0], 'its record is written again')
  // Gone with its root.
  seen.tracker.sync([], () => false, 1, 1e9)
  assert.equal(seen.tracker.farShadowObjects, 0)
})
