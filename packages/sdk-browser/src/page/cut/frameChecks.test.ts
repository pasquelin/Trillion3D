// The CPU cut checks its frame's stretch, focal length, near plane and projection in each
// cluster's projection (`clusterErrorAtDepth`): an unsound frame is refused, by name, at the first
// cluster that projects, and never by a root that projects none.
import test from 'node:test'
import assert from 'node:assert/strict'
import { collectClusterPages } from '../selection/selection.ts'
import { selectVisiblePages } from './cut.fixture.ts'
import { dagFixture, wideCamera } from '../selection/dag.fixture.ts'
import { dagCulling } from '../selection/helpers.fixture.ts'
import { engineCamera } from '../../camera/camera.fixture.ts'
import { createHeldResidency } from './held.fixture.ts'

/** A sound near plane: the unsound frames below break one scalar at a time. */
const NEAR = 0.1 + 2 ** -40
const ASK = { pixelError: 5, viewport: [1280, 720] as [number, number] }

function rootsOf(culling: boolean, flat = false) {
  const fixture = dagFixture()
  const primitive = fixture.metadata.primitives[0]
  if (culling) primitive.culling = dagCulling()
  // Nothing to project: every error zero, no replacement.
  if (flat)
    for (const page of primitive.pages) Object.assign(page, { lodError: 0, parentError: null })
  const { roots } = collectClusterPages(
    fixture.source,
    fixture.metadata,
    fixture.indices,
    fixture.associations,
  )
  fixture.geometry.dispose()
  return roots
}

function cameraWith(near: number, perspective?: number) {
  const cam = engineCamera(wideCamera())
  cam.near = near
  if (perspective !== undefined) cam.perspective = perspective
  return cam
}

test('an unsound frame is refused, by name, once a cluster projects', () => {
  for (const culling of [false, true])
    for (const [near, perspective] of [
      [0, undefined],
      [NaN, undefined],
      [Infinity, undefined],
      [NEAR, 2],
      [NEAR, NaN],
    ] as const) {
      const cam = cameraWith(near, perspective),
        cut = (flat: boolean) =>
          selectVisiblePages(rootsOf(culling, flat), cam, { ...ASK, held: createHeldResidency() })
      assert.throws(() => cut(false), { name: 'Error', message: 'Invalid cluster parameters' })
      // The check did not move to the root: a root whose clusters project nothing still passes.
      assert.ok(cut(true).shown.length > 0, `near ${near}, perspective ${perspective}`)
    }
})
