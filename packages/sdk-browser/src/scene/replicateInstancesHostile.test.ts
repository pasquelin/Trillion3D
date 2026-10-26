// replicateInstances.ts: copies of a source on a grid, flat bounds, hostile hierarchy.
import '../wasm/sdkWasm.fixture.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { replicateInstances } from './replicateInstances.ts'
import { ENGINE_OWNED } from './host/scan/watch.ts'
import { hostWorldBounds } from './host/world/bounds.ts'
import * as G from './host/graph/graph.fixture.ts'
import { Group, type Object3D } from '../../../sdk-core/src/world/object/object3d.ts'
import type { PageMesh } from '../geometry/pages/pageMesh.ts'

/** Two meshes under negative scale root and non-uniform scale child. */
function hostileSource() {
  const rootNode = new Group()
  rootNode.scale.set(-1, 1, 1)
  const child = new Group()
  child.position.set(3, 0, 0)
  child.scale.set(1, 2, 0.5)
  rootNode.add(child)
  const a = G.mesh(G.boxGeometry(1, 1, 1), G.basicSurface())
  a.position.set(0.5, 0, 0)
  child.add(a)
  const b = G.mesh(G.boxGeometry(1, 1, 1), G.basicSurface())
  b.position.set(-0.5, 0, 0)
  child.add(b)
  return { rootNode, a, b }
}

test('replicateInstances(count=1) returns source itself, without copying', () => {
  const { rootNode } = hostileSource()
  const associations = new Map()
  const rendered = replicateInstances(rootNode, associations, 1)
  assert.equal(rendered, rootNode)
})

test('replicateInstances flags each copy ENGINE_OWNED and freezes its matrix (matrixAutoUpdate to false)', () => {
  const { rootNode } = hostileSource()
  const group = replicateInstances(rootNode, new Map(), 4) as Group
  for (const copy of group.children as PageMesh[]) {
    assert.equal(ENGINE_OWNED.has(copy), true)
    assert.equal(copy.matrixAutoUpdate, false)
  }
})

test('replicateInstances transfers association of each source mesh onto its copies', () => {
  const { rootNode, a, b } = hostileSource()
  const associations = new Map<Object3D, { meshes: number }>([
    [a, { meshes: 0 }],
    [b, { meshes: 1 }],
  ])
  const group = replicateInstances(rootNode, associations, 4) as Group
  for (const copy of group.children as PageMesh[])
    assert.ok(associations.get(copy), 'each copy carries association of its source mesh')
})

test('replicateInstances uses `preparedBounds` as is, without recalculating bounds', () => {
  const { rootNode } = hostileSource()
  const actualBounds = hostWorldBounds(rootNode)
  // Deliberately incorrect bounds (twice as wide): if function ignored them to recalculate
  // its own, grid spacing would match real bounds, not these.
  const falseBounds = Float64Array.from([
    actualBounds[0] * 2,
    actualBounds[1],
    actualBounds[2],
    actualBounds[3] * 2,
    actualBounds[4],
    actualBounds[5],
  ])
  const group = replicateInstances(rootNode, new Map(), 4, falseBounds) as Group
  const expectedSpacing = falseBounds[3] - falseBounds[0]
  const actualSpacing = actualBounds[3] - actualBounds[0]
  const firstColumn = (group.children[0] as PageMesh).matrixWorld.elements[12]
  const lastColumn = (group.children[group.children.length - 2] as PageMesh).matrixWorld
    .elements[12]
  assert.notEqual(expectedSpacing, actualSpacing, 'test must use different bounds')
  assert.ok(
    Math.abs(Math.abs(lastColumn - firstColumn) - expectedSpacing) < 1e-9,
    'spacing follows `preparedBounds`, not real bounds',
  )
})

test('invalid replica count throws', () => {
  const { rootNode } = hostileSource()
  assert.throws(() => replicateInstances(rootNode, new Map(), 2 as 1))
})
