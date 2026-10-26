/**
 * The engine's own graph: its camera projection, its watch on a node's pose, the defaults of a
 * copied light and mesh, and its instanced meshes (the geometry's: `graphGeometry.test.ts`).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { Object3D } from '../../../../../sdk-core/src/world/object/object3d.ts'
import { Mesh } from '../../../../../sdk-core/src/world/object/mesh.ts'
import { InstancedMesh } from '../../../../../sdk-core/src/world/object/instancedMesh.ts'
import { Camera } from '../../../../../sdk-core/src/world/camera/camera.ts'
import { perspectiveProjection } from '../../../../../math/src/projection/camera.ts'
import { Light } from '../../../../../sdk-core/src/world/light/light.ts'
import {
  DEFAULT_INNER_CONE_ANGLE,
  DEFAULT_OUTER_CONE_ANGLE,
} from '../../../../../sdk-core/src/scene/light/fields.ts'
import { familySurface } from './graph.fixture.ts'
import { hookHostNode } from '../scan/hooks.ts'
import { Geometry } from '../../../../../sdk-core/src/world/geometry/geometry.ts'

test("a core camera's projection is the engine's own, reversed depth", () => {
  const camera = new Camera('perspective', { fov: 47, aspect: 1.6 })
  assert.deepEqual(
    [...camera.projectionMatrix.elements],
    [...perspectiveProjection(new Float64Array(16), 47, 1.6, 0.1, 1)],
  )
})

test('a watch hears a node moved by its position, its angles or its quaternion', () => {
  const node = new Object3D()
  const revision = { revision: 0, wrote() {} }
  hookHostNode(node, revision)
  node.position.x = 4
  node.rotation.y = 0.5
  node.quaternion.set(0, 0, 0, 1)
  assert.equal(revision.revision, 3)
})

test('a copied light and mesh hold the engine defaults', () => {
  const surface = familySurface('physical')
  const light = new Light('spot')
  const copy = light.clone()
  // The cone's angles are the engine's own defaults (a 44 degree cone with no inner part).
  assert.equal(copy.outerConeAngle, DEFAULT_OUTER_CONE_ANGLE)
  assert.equal(copy.innerConeAngle, DEFAULT_INNER_CONE_ANGLE)
  assert.notEqual(copy.target, light.target, 'a copied light aims at a copy of the target')
  const mesh = new Mesh(new Geometry(), surface)
  assert.equal(mesh.clone().material, surface, 'a copied mesh shares its surface')
})

test('the ambient, rectangle and probe lights copy themselves whole', () => {
  const ambient = new Light('ambient', { intensity: Math.PI }).clone()
  assert.equal(ambient.kind, 'ambient')
  assert.equal(ambient.intensity, Math.PI)
  const rect = new Light('rectArea', { width: 2, height: 3, distance: 9 }).clone()
  assert.deepEqual([rect.kind, rect.width, rect.height, rect.distance], ['rectArea', 2, 3, 9])
  const probe = new Light('probe', { sh: Array.from({ length: 27 }, (_, i) => i) })
  const copy = probe.clone()
  assert.deepEqual([copy.sh![24], copy.sh![26]], [24, 26])
  assert.notEqual(copy.sh, probe.sh)
})

test('an instanced mesh holds one matrix per placement and gives them back once', () => {
  const mesh = new InstancedMesh(new Geometry(), familySurface('standard'), 3)
  assert.equal(mesh.instanceMatrix.array.length, 48)
  assert.equal(mesh.count, 3)
  let released = 0
  mesh.released.add(() => released++)
  mesh.dispose()
  mesh.dispose()
  assert.equal(released, 1)
})
