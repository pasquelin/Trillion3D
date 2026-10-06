/**
 * A mesh costs what it holds: its shape, its matter and how it reads them. The flag, the
 * morph weights and the listener live on the class or appear when used; the geometry and the
 * materials hear the mesh only while it is in a world.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { Mesh, type Primitive } from './mesh.ts'
import { Group } from './object3d.ts'
import { Geometry } from '../geometry/geometry.ts'
import { BufferAttribute } from '../buffer/attribute.ts'
import { Material } from '../material/material.ts'
import { countingLink } from './sceneLink.fixture.ts'
import { ObjectPhysics } from '../../physics/objectPhysics.ts'

test('a mesh holds its shape, its matter and its primitive, nothing more of its own', () => {
  const mesh = new Mesh(new Geometry(), new Material('meshBasic'))
  const own = Object.keys(new Group())
  const added = Object.keys(mesh).filter((key) => !own.includes(key))
  assert.deepEqual(added.sort(), ['_geometry', '_material', 'primitive'])
  assert.equal(mesh.isMesh, true, 'the flag reads from the class')
  assert.equal(mesh.morphTargetInfluences, undefined, 'no morph, no weights')
})

test('a mesh is heard by its geometry and materials only while it is in a world', () => {
  const geometry = new Geometry(),
    material = new Material('meshBasic')
  const mesh = new Mesh(geometry, material)
  assert.equal(geometry._listeners.size + material._listeners.size, 0, 'outside a world: none')
  const scene = new Group(),
    { link, heard } = countingLink()
  scene._link = link
  scene.add(mesh)
  assert.deepEqual([geometry._listeners.size, material._listeners.size], [1, 1])
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(3), 3))
  material.opacity = 0.5
  assert.ok(heard.filter((node) => node === mesh).length >= 2, 'both changes reach the world')
  const other = new Geometry()
  mesh.geometry = other
  assert.deepEqual([geometry._listeners.size, other._listeners.size], [0, 1], 'the new shape')
  scene.remove(mesh)
  assert.equal(other._listeners.size + material._listeners.size, 0, 'left the world: none')
  scene.add(mesh)
  scene.remove(mesh)
  scene.add(mesh)
  assert.deepEqual([other._listeners.size, material._listeners.size], [1, 1], 'relinked: once')
})

test('a mesh wearing matter that tells nothing enters and leaves a world', () => {
  const scene = new Group(),
    mesh = new Mesh<object>(new Geometry(), {})
  scene._link = countingLink().link
  scene.add(mesh)
  scene.remove(mesh)
  assert.equal(mesh.geometry._listeners.size, 0)
})

test('a mesh destroyed in a world leaves it, heard by nothing it wore', () => {
  const geometry = new Geometry(),
    material = new Material('meshBasic')
  const scene = new Group(),
    group = new Group(),
    mesh = new Mesh(geometry, material),
    told: object[] = []
  scene._link = { ...countingLink().link, structure: (node: object) => told.push(node) }
  group.add(mesh)
  scene.add(group)
  told.length = 0
  group.destroy()
  assert.equal(geometry._listeners.size + material._listeners.size, 0)
  assert.deepEqual([group._link, mesh._link, scene.children.length], [null, null, 0])
  assert.deepEqual(told, [scene], 'the world is told its structure changed')
})

test('a mesh moved out of a world under a group none hears leaves it, and the world is told', () => {
  const material = new Material('meshBasic')
  const scene = new Group(),
    aside = new Group(),
    mesh = new Mesh(new Geometry(), material),
    told: object[] = []
  scene._link = { ...countingLink().link, structure: (node: object) => told.push(node) }
  scene.add(mesh)
  told.length = 0
  aside.add(mesh)
  assert.deepEqual([mesh._link, material._listeners.size], [null, 0])
  assert.deepEqual(told, [scene], 'the world it left hears it go')
  scene.add(aside)
  told.length = 0
  scene.attach(mesh)
  assert.deepEqual(told, [aside, scene], 'moved within one world: both parents told, once each')
})

test('mesh primitive and shadow defaults survive a shallow clone', () => {
  const primitives: Primitive[] = [
    'triangles',
    'points',
    'lineStrip',
    'lineSegments',
    'lineLoop',
    'sprite',
  ]
  for (const primitive of primitives) {
    const mesh = new Mesh(undefined, undefined, primitive)
    const copy = mesh.clone(false)
    assert.equal(copy.type, mesh.type)
    assert.equal(copy.primitive, primitive)
    assert.equal(copy.geometry, mesh.geometry)
    assert.equal(copy.material, mesh.material)
  }
})

test('morph names and zero weights follow the first morphed attribute only', () => {
  const geometry = new Geometry()
  const named = new BufferAttribute(new Float32Array([1, 2, 3]), 3)
  named.name = 'smile'
  geometry.morphAttributes.position = [named, new BufferAttribute(new Float32Array(3), 3)]
  geometry.morphAttributes.normal = [named]
  const mesh = new Mesh(geometry)
  assert.deepEqual(mesh.morphTargetInfluences, [0, 0])
  assert.deepEqual(mesh.morphTargetDictionary, { smile: 0, '1': 1 })
  mesh.morphTargetInfluences![0] = 0.75
  mesh.updateMorphTargets()
  assert.deepEqual(mesh.morphTargetInfluences, [0, 0])
})

test('replacing grouped materials notifies the world and releases every old listener', () => {
  const first = new Material('meshBasic'),
    second = new Material('meshBasic')
  const replacement = new Material('meshBasic')
  const mesh = new Mesh(new Geometry(), [first, second])
  const scene = new Group(),
    { link, heard } = countingLink()
  scene._link = link
  scene.add(mesh)
  heard.length = 0
  first.opacity = 0.4
  second.opacity = 0.6
  assert.deepEqual(heard, [mesh, mesh])
  mesh.material = replacement
  assert.deepEqual(heard, [mesh, mesh, mesh])
  heard.length = 0
  first.opacity = 0.2
  second.opacity = 0.3
  assert.deepEqual(heard, [])
  replacement.opacity = 0.5
  assert.deepEqual(heard, [mesh])
  scene.remove(mesh)
  const geometry = new Geometry()
  mesh.geometry = geometry
  mesh.material = [first, second]
  assert.deepEqual(
    [geometry._listeners.size, first._listeners.size, second._listeners.size],
    [0, 0, 0],
  )
})

test('physics assignment preserves supplied bodies, constructs options and reports removal', () => {
  const mesh = new Mesh(),
    { link, heard } = countingLink()
  mesh._link = link
  assert.equal(mesh.physics, null)
  const body = new ObjectPhysics('kinematic')
  mesh.physics = body
  assert.equal(mesh.physics, body)
  mesh.physics = { type: 'dynamic', mass: 7 }
  assert.ok(mesh.physics instanceof ObjectPhysics)
  assert.equal(mesh.physics.type, 'dynamic')
  assert.equal(mesh.physics.mass, 7)
  mesh.physics = null
  assert.equal(mesh.physics, null)
  assert.deepEqual(heard, [mesh, mesh, mesh])
})
