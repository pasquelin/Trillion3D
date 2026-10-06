// bounds.ts: world bounds of a host subtree, checked bit-for-bit
// (Object.is) against the host library's own subtree box, empty boxes and
// geometry without a mesh included.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import {
  emptyWorldBox,
  hostWorldBounds,
} from '../../../../../../../packages/sdk-browser/src/host/world/bounds.ts'
import { assertBits } from '../../../../../../../tests/kit/assert/bits.ts'
import * as G from '../../../../../../../packages/sdk-browser/src/host/graph/graph.fixture.ts'
import { threeGraph } from '../../../../fromGraphNodes.ts'
import { threeGeometry } from '../../../../fromGraph.ts'

/** The same box, flattened, as the host library computes it. */
function referenceBox(graph: G.Object3D) {
  const source = threeGraph(graph)
  const box = new THREE.Box3().setFromObject(source)
  return [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z]
}

/** Hostile subtree, depth 3: negative then non-uniform scale, two meshes. */
function hostileScene() {
  const rootNode = new G.Group()
  rootNode.scale.set(-2, 1, 1)
  const child = new G.Group()
  child.position.set(5, -5, 0)
  child.scale.set(1, 3, 0.001)
  rootNode.add(child)
  const geometryA = G.boxGeometry(2, 2, 2)
  const meshA = G.mesh(geometryA, G.basicSurface())
  meshA.position.set(1, 1, 1)
  child.add(meshA)
  const grandchild = new G.Group()
  grandchild.position.set(0, 0, 100)
  child.add(grandchild)
  const geometryB = G.sphereGeometry(1)
  const meshB = G.mesh(geometryB, G.basicSurface())
  meshB.position.set(-3, 2, -1)
  grandchild.add(meshB)
  return rootNode
}

test('hostWorldBounds agrees with Box3.setFromObject on a hostile subtree, depth 3', () => {
  const actual = hostWorldBounds(hostileScene())
  assertBits(actual, referenceBox(hostileScene()))
})

test('a subtree with no geometry at all returns an empty box, like Box3.setFromObject', () => {
  const source = new G.Group()
  source.add(new G.Group(), new G.Object3D())
  const actual = hostWorldBounds(source)
  const expected = new THREE.Box3().setFromObject(threeGraph(source))
  assert.ok(expected.isEmpty(), 'the expected box must be empty for this test to mean anything')
  assertBits(actual, [...expected.min.toArray(), ...expected.max.toArray()])
})

test('emptyWorldBox returns an independent empty box on every call', () => {
  const a = emptyWorldBox(),
    b = emptyWorldBox()
  assert.notEqual(a, b, 'two distinct buffers')
  assertBits(a, [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity])
})

test('geometry carried by a node that is not a mesh counts, like expandByObject', () => {
  const source = new G.Group()
  const cloud = Object.assign(new G.Object3D(), { geometry: G.sphereGeometry(3) })
  cloud.position.set(10, -10, 10)
  source.add(cloud)
  // The host library reads a point cloud of the same geometry, the library's node carrying one.
  const witness = new THREE.Points(threeGeometry(cloud.geometry), new THREE.PointsMaterial())
  witness.position.set(10, -10, 10)
  const expected = new THREE.Box3().setFromObject(new THREE.Group().add(witness))
  assertBits(hostWorldBounds(source), [...expected.min.toArray(), ...expected.max.toArray()])
})

test("an object's own box (object.boundingBox) wins over its geometry's, like expandByObject", () => {
  const source = new G.Group()
  const mesh: G.HostMesh & { boundingBox?: G.Box3 | null } = G.mesh(
    G.boxGeometry(100, 100, 100),
    G.basicSurface(),
  )
  // Object box much smaller than its 100×100×100 geometry box.
  mesh.boundingBox = new G.Box3(new G.Vector3(-1, -1, -1), new G.Vector3(1, 1, 1))
  source.add(mesh)
  const actual = hostWorldBounds(source)
  // The library's copy carries no own box: the witness is given the same one.
  const witness = threeGraph(source)
  Object.assign(witness.children[0], {
    boundingBox: new THREE.Box3().setFromArray([-1, -1, -1, 1, 1, 1]),
  })
  const box = new THREE.Box3().setFromObject(witness)
  assertBits(actual, [...box.min.toArray(), ...box.max.toArray()])
  // Check the test is not empty: the small object box is indeed the one returned.
  assert.ok(actual[3] < 50, 'the geometry box (100×100×100) should not have been taken')
})

test('hostWorldBounds accumulates into an already started `into` instead of replacing it', () => {
  const into = new Float64Array(6)
  into.set([-1, -1, -1, 1, 1, 1])
  const mesh = G.mesh(G.boxGeometry(1, 1, 1), G.basicSurface())
  mesh.position.set(50, 0, 0)
  const actual = hostWorldBounds(mesh, into)
  assert.equal(actual, into, 'the same buffer is returned')
  assert.ok(actual[3] > 40, 'the starting box is extended, not overwritten')
  assert.equal(actual[0], -1, 'the starting low bound is kept on x')
})
