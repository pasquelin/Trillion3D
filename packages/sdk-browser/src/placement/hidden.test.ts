// A host visibility change hands each root that flipped to `flip`, once: its rows, derived again,
// stale the shadow pages it left or entered (`rowCastWgsl.ts`); no box is declared on the CPU.
import test from 'node:test'
import assert from 'node:assert/strict'
import { Object3D } from '../../../sdk-core/src/world/object/object3d.ts'
import type { ClusterRoot } from '../page/selection/types.ts'
import { followHostVisibility } from './hidden.ts'

test('followHostVisibility: no root handed while none flips, each flipped root once', () => {
  const [a, b, c] = [new Object3D(), new Object3D(), new Object3D()]
  // Each stands for a mesh, which casts unless set otherwise.
  for (const node of [a, b, c]) node.castShadow = true
  const roots = [a, b, c].map((node) => ({
    pages: [{ drawSource: { node } }],
  })) as unknown as ClusterRoot<{ drawSource: { node: Object3D } }>[]
  const parked: [number, boolean][] = []
  const none = { entries: [], sourceOf: () => undefined }
  const follow = () => {
    parked.length = 0
    followHostVisibility(roots, none, (rank, root) => parked.push([rank, !!root.parked]))
    return parked.flat()
  }
  assert.deepEqual(follow(), [])
  a.visible = false
  b.visible = false
  assert.deepEqual(follow(), [0, true, 1, true])
  assert.deepEqual(follow(), [], 'no flip since')
  b.visible = true
  assert.deepEqual(follow(), [1, false])
  c.castShadow = false
  assert.deepEqual(follow(), [2, false], 'a root that stops casting flips where it stands')
})
