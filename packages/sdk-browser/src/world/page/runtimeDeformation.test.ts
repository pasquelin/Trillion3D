import test from 'node:test'
import assert from 'node:assert/strict'
import { Geometry } from '../../../../sdk-core/src/world/geometry/geometry.ts'
import { BufferAttribute } from '../../../../sdk-core/src/world/buffer/attribute.ts'
import { drawnTriangles } from '../../../../sdk-core/src/world/geometry/drawn.ts'
import { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts'
import { packDrawn, unpackDrawn } from './runtimePack.ts'
import { runtimeDeformation } from './runtimeDeformation.ts'
import { createPlacementRows } from '../../placement/rows.ts'
import { createSessionDeformation } from '../../deformation/session.ts'
import { recordLayout } from '../../deformation/layout.ts'
import type { ClusterRoot } from '../../page/selection/types.ts'
import type { PageRec } from '../../page/selection/selection.ts'

function geometry() {
  const g = new Geometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3))
  g.setAttribute(
    'skinIndex',
    new BufferAttribute(new Uint16Array([0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2]), 4),
  )
  g.setAttribute(
    'skinWeight',
    new BufferAttribute(new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]), 4),
  )
  g.setIndex([2, 0, 1])
  g.morphTargetsRelative = true
  g.morphAttributes.position = [
    new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 2, 0, 0, 3]), 3),
  ]
  return g
}

test('runtime worker preserves skin and morph streams after flat and point permutations', () => {
  for (const reading of ['triangles', 'points'] as const) {
    const drawn = drawnTriangles(geometry(), reading, { flat: true })!
    const packed = unpackDrawn(packDrawn(drawn, true)).drawn
    assert.deepEqual(packed.deformation, drawn.deformation)
    for (let v = 0; v < drawn.positions.length / 3; v++) {
      const source = drawn.sourceVertices![v]
      assert.equal(packed.deformation!.joints![v * 4], source)
      assert.equal(packed.deformation!.targets[0].positions[v * 3 + 2], source + 1)
    }
    assert.equal(runtimeDeformation(packed)!.targets[0], 3)
  }
})

test('page-authored placement uploads its own morph weights and resets history on row reuse', () => {
  const a = new Mesh(geometry()),
    b = new Mesh(geometry()),
    mirror = new Mesh()
  a.morphTargetInfluences![0] = 0.25
  b.morphTargetInfluences![0] = 0.75
  const owners = [a],
    rows = createPlacementRows(1)
  rows.sources = owners
  rows.sourceModels = new Set([a, b])
  const measured = runtimeDeformation(drawnTriangles(a.geometry, 'triangles')!)!
  // This row exercises morph only; its mirrored host intentionally has no source properties.
  measured.joints = []
  const root = {
    pages: [{ sourceMesh: mirror }],
    world: a.matrixWorld,
    placement: { rows, index: 0 },
    deformation: measured,
  } as unknown as ClusterRoot<PageRec>
  const session = createSessionDeformation([root])
  assert.equal(session.any, true)
  session.frame.update(() => false)
  const at = recordLayout({ joints: 0, targets: 1, waves: 0 }).weights
  assert.deepEqual([...session.frame.block.slice(at, at + 2)], [0.25, 0.25])
  owners[0] = b
  assert.equal(session.frame.pending(), true)
  session.frame.update(() => false)
  assert.deepEqual([...session.frame.block.slice(at, at + 2)], [0.75, 0.75])
})
