// Batch M4a, replicateInstances.ts: world matrices of copies calculated by core's
// `multiplyMatrix4`, flat bounds. Compared bit-by-bit (Object.is) to legacy path
// (a matrix copy then a walk of the host group's graph), including hostile hierarchy.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { replicateInstances } from '../../../../../../packages/sdk-browser/src/scene/replicateInstances.ts'
import { ENGINE_OWNED } from '../../../../../../packages/sdk-browser/src/host/scene/watch.ts'
import { hostWorldBounds } from '../../../../../../packages/sdk-browser/src/host/world/bounds.ts'
import { assertBits } from '../../../../../../tests/kit/assert/bits.ts'
import * as G from '../../../../../../packages/sdk-browser/src/host/graph/graph.fixture.ts'
import { threeGraph } from '../../../fromGraphNodes.ts'

/** Two meshes under negative scale root and non-uniform scale child. */
function hostileSource() {
  const rootNode = new G.Group()
  rootNode.scale.set(-1, 1, 1)
  const child = new G.Group()
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

/** Legacy path, before batch M4a: a matrix copy then a walk of the host group's graph. */
function referenceReplicate(graph: G.Object3D, count: 1 | 4 | 9 | 12) {
  const source = threeGraph(graph)
  source.updateMatrixWorld(true)
  if (count === 1) return source
  const bounds = new THREE.Box3().setFromObject(source)
  const size = new THREE.Vector3()
  bounds.getSize(size)
  const [columns, rows] = count === 12 ? [4, 3] : [Math.sqrt(count), Math.sqrt(count)]
  const group = new THREE.Group()
  const meshes: THREE.Mesh[] = []
  source.traverse((o: THREE.Object3D) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh)
  })
  for (let z = 0; z < rows; z++)
    for (let x = 0; x < columns; x++)
      for (const mesh of meshes) {
        const copy = new THREE.Mesh(mesh.geometry, mesh.material)
        copy.matrixAutoUpdate = false
        copy.matrix.copy(mesh.matrixWorld)
        copy.matrix.elements[12] += (x - (columns - 1) / 2) * size.x
        copy.matrix.elements[14] += (z - (rows - 1) / 2) * size.z
        group.add(copy)
      }
  group.updateMatrixWorld(true)
  return group
}

test('replicateInstances(count=1) returns source itself, without copying', () => {
  const { rootNode } = hostileSource()
  const associations = new Map()
  const rendered = replicateInstances(rootNode, associations, 1)
  assert.equal(rendered, rootNode)
})

for (const count of [4, 9, 12] as const) {
  test(`replicateInstances(count=${count}) : world matrices of copies bit-for-bit identical to legacy path, hostile source`, () => {
    const actual = hostileSource()
    const expected = hostileSource()
    const groupActual = replicateInstances(actual.rootNode, new Map(), count) as G.Group
    const groupExpected = referenceReplicate(expected.rootNode, count) as THREE.Group
    assert.equal(groupActual.children.length, groupExpected.children.length)
    for (let i = 0; i < groupActual.children.length; i++)
      assertBits(
        (groupActual.children[i] as G.HostMesh).matrixWorld.elements,
        (groupExpected.children[i] as THREE.Mesh).matrixWorld.elements,
      )
  })
}

test('replicateInstances flags each copy ENGINE_OWNED and freezes its matrix (matrixAutoUpdate to false)', () => {
  const { rootNode } = hostileSource()
  const group = replicateInstances(rootNode, new Map(), 4) as G.Group
  for (const copy of group.children as G.HostMesh[]) {
    assert.equal(copy.userData[ENGINE_OWNED], true)
    assert.equal(copy.matrixAutoUpdate, false)
  }
})

test('replicateInstances transfers association of each source mesh onto its copies', () => {
  const { rootNode, a, b } = hostileSource()
  const associations = new Map<G.Object3D, { meshes: number }>([
    [a, { meshes: 0 }],
    [b, { meshes: 1 }],
  ])
  const group = replicateInstances(rootNode, associations, 4) as G.Group
  for (const copy of group.children as G.HostMesh[])
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
  const group = replicateInstances(rootNode, new Map(), 4, falseBounds) as G.Group
  const expectedSpacing = falseBounds[3] - falseBounds[0]
  const actualSpacing = actualBounds[3] - actualBounds[0]
  const firstColumn = (group.children[0] as G.HostMesh).matrixWorld.elements[12]
  const lastColumn = (group.children[group.children.length - 2] as G.HostMesh).matrixWorld
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
