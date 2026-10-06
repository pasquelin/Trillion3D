// worldMembers.ts with the scene's own reports (`Object3D.add`, `remove`, the link a node enters a
// world with): who the world draws stays exact through a move between parents, a subtree edited
// while out of the world and brought back in the same burst, and a node destroyed in the world.
import test from 'node:test'
import assert from 'node:assert/strict'
import { object, type Object3D } from '../../../../sdk-core/src/world/object/index.ts'
import { geometry } from '../../../../sdk-core/src/world/geometry/index.ts'
import type { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts'
import type { SceneLink } from '../../../../sdk-core/src/world/object/object3d.ts'
import { createWorldMembers } from './worldMembers.ts'
import { Scene } from './scene.ts'

/** A scene whose link reports every changed parent to its members, as the world's does. */
function world() {
  const scene = new Scene(),
    members = createWorldMembers(scene)
  scene._link = {
    pose: () => {},
    posed: () => {},
    structure: (parent: Object3D) => members.changed(parent),
    entered: (node: Object3D) => members.entered(node),
    content: () => {},
  } as SceneLink
  return { scene, members, drawn: (mesh: Mesh) => members.meshes.has(mesh) }
}
const box = () => object.mesh(geometry.box(1, 1, 1))

test('a mesh moved between parents stays drawn when its former parent changes later', () => {
  const { scene, members, drawn } = world()
  const [a, b] = [object.group(), object.group()],
    mesh = box()
  scene.add(a, b)
  a.add(mesh)
  members.take()
  b.add(mesh)
  members.take()
  a.add(box())
  members.take()
  assert.equal(drawn(mesh), true, 'the former parent no longer lists it')
})

test('a mesh added under a node out of the world, brought back in the same burst, is drawn', () => {
  const { scene, members, drawn } = world()
  const group = object.group(),
    inner = object.group(),
    mesh = box()
  scene.add(group)
  group.add(inner)
  members.take()
  scene.remove(group)
  inner.add(mesh)
  scene.add(group)
  const { added } = members.take()
  assert.deepEqual([drawn(mesh), added.includes(mesh)], [true, true])
})

test('a node destroyed in the world leaves it, its meshes with it, and nothing throws', () => {
  const { scene, members, drawn } = world()
  const group = object.group(),
    mesh = box()
  scene.add(group)
  group.add(mesh)
  members.take()
  group.add(object.group()) // heard, then destroyed before the world reads it
  group.destroy()
  const { removed } = members.take()
  assert.deepEqual([drawn(mesh), removed.includes(mesh)], [false, true])
})
