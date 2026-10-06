import test from 'node:test'
import assert from 'node:assert/strict'
import { Object3D, Group } from './object3d.ts'
import { countingLink } from './sceneLink.fixture.ts'

test('each write of a pose reaches the world once, and a turn by angles turns the node', () => {
  const node = new Object3D(),
    { link, posed } = countingLink()
  node._link = link
  for (const write of [
    () => node.position.set(1, 2, 3),
    () => node.scale.set(2, 2, 2),
    () => node.rotation.set(0, Math.PI / 2, 0),
    () => node.quaternion.set(0, 0, 0, 1),
  ]) {
    posed.length = 0
    write()
    assert.deepEqual(posed, [node])
  }
  node.rotation.set(0, Math.PI / 2, 0)
  node.updateMatrixWorld(true)
  const facing = node.getWorldDirection().toArray()
  assert.ok(Math.abs(facing[0] - 1) < 1e-9, 'a quarter turn about y faces +x')
})

test('a node attached where it stands, in a world, is posed once', () => {
  const parent = new Group(),
    node = new Object3D(),
    { link, posed } = countingLink()
  parent.position.set(5, 0, 0)
  parent.rotation.set(0, 1, 0)
  parent.updateMatrixWorld(true)
  parent._link = link
  posed.length = 0
  parent.attach(node)
  assert.equal(posed.filter((n) => n === node).length, 1)
})
