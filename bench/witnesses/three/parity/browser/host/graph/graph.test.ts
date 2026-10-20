/**
 * The engine's own graph holds the host library's numbers: the same poses composed into the same
 * world matrices, the same aim, the same projection, and the same defaults of a texture, a surface
 * and a copied light. Each rule is checked against the host library, which a test may name, on
 * values away from the trivial ones (the geometry's: `graphGeometry.test.ts`).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import {
  Group,
  Object3D,
} from '../../../../../../../packages/sdk-core/src/world/object/object3d.ts'
import { Mesh } from '../../../../../../../packages/sdk-core/src/world/object/mesh.ts'
import { InstancedMesh } from '../../../../../../../packages/sdk-core/src/world/object/instancedMesh.ts'
import { Camera } from '../../../../../../../packages/sdk-core/src/world/camera/camera.ts'
import { perspectiveProjection } from '../../../../../../../packages/math/src/projection/camera.ts'
import { Light } from '../../../../../../../packages/sdk-core/src/world/light/light.ts'
import { familySurface } from '../../../../../../../packages/sdk-browser/src/scene/host/graph/graph.fixture.ts'
import { threeMaterials } from '../../../../fromSurface.ts'
import { Texture } from '../../../../../../../packages/sdk-core/src/world/texture/texture.ts'
import { hookHostNode } from '../../../../../../../packages/sdk-browser/src/scene/host/scan/hooks.ts'
import { Geometry } from '../../../../../../../packages/sdk-core/src/world/geometry/geometry.ts'
import { ulpBetween } from '../../../../../../../packages/math/src/float/ulp.fixture.ts'

test('a posed chain resolves to the independent world matrices, aim and decomposition included', () => {
  const [a, b, c] = [
    new Group(),
    new Object3D(),
    new Camera('perspective', { fov: 47, aspect: 1.6 }),
  ]
  const [ta, tb, tc] = [
    new THREE.Group(),
    new THREE.Object3D(),
    new THREE.PerspectiveCamera(47, 1.6),
  ]
  a.add(b.add(c))
  ta.add(tb.add(tc))
  ;[a, b, c].forEach((node, k) => node.position.set(1.5 * k, -2.25, 0.125 + k))
  ;[ta, tb, tc].forEach((node, k) => node.position.set(1.5 * k, -2.25, 0.125 + k))
  const q = new THREE.Quaternion(0.1, 0.7, -0.2, 0.6).normalize()
  b.quaternion.set(q.x, q.y, q.z, q.w)
  tb.quaternion.copy(q)
  a.scale.set(1, 3, 0.5)
  ta.scale.set(1, 3, 0.5)
  c.lookAt({ x: 4, y: -1, z: 9 })
  tc.lookAt(4, -1, 9)
  // The aim's local turn is one quaternion product where the host premultiplies: a component may
  // move by its last bit. The host then takes the engine's turn, so the composition below compares
  // bit for bit.
  const turn = [c.quaternion.x, c.quaternion.y, c.quaternion.z, c.quaternion.w]
  turn.forEach((v, i) => assert.ok(ulpBetween(v, tc.quaternion.toArray()[i]) <= 1, `turn[${i}]`))
  tc.quaternion.set(turn[0], turn[1], turn[2], turn[3])
  a.updateMatrixWorld(true)
  ta.updateMatrixWorld(true)
  assert.deepEqual([...c.matrixWorld.elements], tc.matrixWorld.elements)
  // The camera's projection is the engine's own, reversed depth: not the host's.
  assert.deepEqual(
    [...c.projectionMatrix.elements],
    [...perspectiveProjection(new Float64Array(16), 47, 1.6, 0.1, 1)],
  )
  assert.deepEqual([c.rotation.x, c.rotation.y, c.rotation.z], tc.rotation.toArray().slice(0, 3))
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(3, -1, 2),
    q,
    new THREE.Vector3(-2, 1.5, 0.25),
  )
  const [n, tn] = [new Object3D(), new THREE.Object3D()]
  n.applyMatrix4({ elements: m.elements })
  tn.applyMatrix4(m)
  const numbers = (node: Object3D | THREE.Object3D) =>
    [node.position, node.quaternion, node.scale].flatMap((v) => [v.x, v.y, v.z])
  assert.deepEqual(numbers(n), numbers(tn))
  assert.equal(n.quaternion.w, tn.quaternion.w)
})

test('a rotation premultiplied by another turns as the plain product', () => {
  const [q, p] = [new Object3D().quaternion, new Object3D().quaternion]
  const tq = new THREE.Quaternion(0.1, 0.7, -0.2, 0.6).normalize()
  const tp = new THREE.Quaternion(-0.4, 0.3, 0.8, 0.2).normalize()
  q.copy(tq)
  p.copy(tp)
  q.premultiply(p)
  tq.premultiply(tp)
  assert.deepEqual([q.x, q.y, q.z, q.w], tq.toArray())
})

test('angles and quaternion follow each other, and a watch hears either face', () => {
  const node = new Object3D(),
    reference = new THREE.Object3D()
  node.rotation.set(0.3, -1.1, 2.4)
  reference.rotation.set(0.3, -1.1, 2.4)
  const { x, y, z, w } = node.quaternion
  assert.deepEqual([x, y, z, w], reference.quaternion.toArray())
  const revision = { revision: 0, wrote() {} }
  hookHostNode(node, revision)
  node.position.x = 4
  node.rotation.y = 0.5
  node.quaternion.set(0, 0, 0, 1)
  assert.equal(revision.revision, 3)
})

test('a texture transform, a surface family and a copied light hold the default values', () => {
  const texture = new Texture(null),
    reference = new THREE.Texture()
  for (const t of [texture, reference]) {
    t.offset.set(0.25, -0.5)
    t.repeat.set(2, 3)
    t.rotation = 0.7
  }
  reference.updateMatrix()
  assert.deepEqual([...texture.transform], reference.matrix.elements)
  const surface = familySurface('physical'),
    drawn = threeMaterials(surface) as unknown as Record<string, unknown>,
    physical = new THREE.MeshPhysicalMaterial() as unknown as Record<string, unknown>
  for (const key of ['ior', 'blending', 'side', 'alphaTest'])
    assert.equal(drawn[key], physical[key], key)
  const light = new Light('spot'),
    spot = new THREE.SpotLight()
  const copy = light.clone()
  assert.deepEqual(
    [copy.angle, copy.penumbra, copy.decay, copy.distance, copy.position.x, copy.position.y],
    [spot.angle, spot.penumbra, spot.decay, spot.distance, spot.position.x, spot.position.y],
  )
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
