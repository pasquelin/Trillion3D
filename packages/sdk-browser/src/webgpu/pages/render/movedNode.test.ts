// A root an instance row places is named by the mesh its row belongs to (`rootSource`), and the
// index by node that names it follows the row's owner: a row re-seated on another mesh is named by
// the new one and no longer by the old, once its owner's write is followed (`followPlacementRows`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { Object3D } from '../../../../../sdk-core/src/world/object/object3d.ts'
import { createPlacementRows } from '../../../placement/rows.ts'
import { followPlacementRows } from '../../../placement/update.ts'
import type { ClusterRoot } from '../../../page/selection/types.ts'
import type { PageRec } from '../../../page/selection/selection.ts'
import { appendRootsUnder, type RootsOwner } from './movedNode.ts'

test('a row re-seated on another mesh is named by the new one, never the old', () => {
  const [first, second] = [new Object3D(), new Object3D()]
  const rows = createPlacementRows(1),
    owners: (Object3D | null)[] = [first]
  rows.sources = owners as never
  rows.live[0] = 1
  const roots = [
    { pages: [], placement: { rows, index: 0 }, world: { elements: new Float64Array(16) } },
  ] as unknown as ClusterRoot<PageRec>[]
  // The layout that holds the roots, and their index by node.
  const layout: RootsOwner = { selectionRoots: roots }
  const under = (node: Object3D) => appendRootsUnder(layout, node, [], 0)
  const follow = () =>
    followPlacementRows(roots, rows, 0, 0, undefined, undefined, undefined, layout)
  follow()
  assert.equal(under(first), 1, 'the row names its owner')
  // The owner re-seats the row on another mesh and writes it: the engine follows the write.
  owners[0] = second
  follow()
  assert.equal(under(second), 1, 'the new owner names the root')
  assert.equal(under(first), 0, 'the old owner names nothing')
})
