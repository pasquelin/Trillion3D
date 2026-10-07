// Batch M4a, camera.ts: framing by flat bounds and core `sphereFromBounds` instead of
// a host box's centre and half-diagonal. Confronted bit for bit (Object.is) with the old
// path on hostile bounds.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { createExplorerCamera } from '../../../../../../../packages/sdk-browser/src/world/camera/camera.ts'
import { assertBits } from '../../../../../../../tests/kit/assert/bits.ts'
import * as G from '../../../../../../../packages/sdk-browser/src/host/graph/graph.fixture.ts'
import { threeGraph } from '../../../../fromGraphNodes.ts'

const canvas = { width: 800, height: 450 } as unknown as HTMLCanvasElement

/** The old path: `expandByObject` per mesh, `getCenter`/`getSize().length()/2`. */
function referenceFraming(graph: G.Object3D) {
  const source = threeGraph(graph)
  const bounds = new THREE.Box3()
  source.updateMatrixWorld(true) // the old `objects()` of ../../scene/meshes.ts resolved the subtree before walking it
  source.traverse((o: THREE.Object3D) => {
    if ((o as THREE.Mesh).isMesh) bounds.expandByObject(o as THREE.Mesh)
  })
  const center = bounds.getCenter(new THREE.Vector3()),
    radius = bounds.getSize(new THREE.Vector3()).length() / 2
  return { bounds, center, radius }
}

/** Hostile subtree, depth 3: negative then non-uniform scale. */
function hostileScene() {
  const rootNode = new G.Group()
  rootNode.scale.set(-3, 1, 1)
  const child = new G.Group()
  child.position.set(2, -4, 6)
  child.scale.set(1, 0.25, 5)
  rootNode.add(child)
  const grandchild = new G.Group()
  grandchild.position.set(1, 1, 1)
  child.add(grandchild)
  const mesh = G.mesh(G.boxGeometry(2, 3, 4), G.basicSurface())
  mesh.position.set(-1, 2, -3)
  grandchild.add(mesh)
  return rootNode
}

test('createExplorerCamera yields the same bounds, centre and radius as expandByObject + getCenter/getSize().length()/2', () => {
  const source = hostileScene()
  const { bounds: b, center, radius } = referenceFraming(source)
  const rendered = createExplorerCamera(hostileScene(), canvas, { manifestUrl: '' })
  assertBits(
    [rendered.bounds.min.x, rendered.bounds.min.y, rendered.bounds.min.z],
    [b.min.x, b.min.y, b.min.z],
  )
  assertBits(
    [rendered.bounds.max.x, rendered.bounds.max.y, rendered.bounds.max.z],
    [b.max.x, b.max.y, b.max.z],
  )
  assertBits(
    [rendered.center.x, rendered.center.y, rendered.center.z],
    [center.x, center.y, center.z],
  )
  assert.ok(Object.is(rendered.radius, radius), `radius: ${rendered.radius} !== ${radius}`)
})

test('createExplorerCamera throws on a scene with no geometry, empty bounds', () => {
  const source = new G.Group()
  source.add(new G.Group())
  assert.throws(
    () => createExplorerCamera(source, canvas, { manifestUrl: '' }),
    /Empty scene bounds/,
  )
})
