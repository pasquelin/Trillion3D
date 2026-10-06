import test from 'node:test'
import assert from 'node:assert/strict'
import { Geometry } from './geometry.ts'
import { BufferAttribute } from '../buffer/attribute.ts'

const sheet = () =>
  new Geometry().setAttribute(
    'position',
    new BufferAttribute(new Float32Array([1, 2, 3, 7, 2, 3, 1, 5, 3]), 3),
  )

test('geometry changes notify holders, invalidate position bounds and preserve unrelated bounds', () => {
  const geometry = sheet()
  let writes = 0
  geometry._listeners.add(() => writes++)
  const box = geometry.computeBoundingBox(),
    sphere = geometry.computeBoundingSphere()
  geometry.recipe = { type: 'triangle', args: [] }
  const initial = geometry.version
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1]), 2))
  assert.equal(geometry.version, initial + 1)
  assert.equal(writes, 1)
  assert.equal(geometry.boundingBox, box)
  assert.equal(geometry.boundingSphere, sphere)
  assert.equal(geometry.recipe, null)
  assert.equal(geometry.hasAttribute('uv'), true)
  geometry.getAttribute('position')!.needsUpdate = true
  assert.equal(geometry.boundingBox, null)
  assert.equal(geometry.boundingSphere, null)
  assert.equal(writes, 2)
  geometry.deleteAttribute('uv')
  assert.equal(geometry.hasAttribute('uv'), false)
  assert.equal(geometry.getAttribute('uv'), undefined)
  geometry.addGroup(0, 3, 2)
  geometry.addGroup(3, 6)
  assert.deepEqual(geometry.groups, [
    { start: 0, count: 3, materialIndex: 2 },
    { start: 3, count: 6, materialIndex: 0 },
  ])
  geometry.clearGroups()
  assert.deepEqual(geometry.groups, [])
  geometry.setIndex([2, 1, 0])
  assert.deepEqual([...geometry.getIndex()!.array], [2, 1, 0])
  geometry.setIndex(null)
  assert.equal(geometry.getIndex(), null)
})

test('geometry transforms preserve winding normals and independently known position extents', () => {
  const geometry = sheet().computeVertexNormals()
  assert.deepEqual([...geometry.getAttribute('normal')!.array], [0, 0, 1, 0, 0, 1, 0, 0, 1])
  geometry.scale(2, 3, 4).translate(-2, -6, -12)
  assert.deepEqual([...geometry.getAttribute('position')!.array], [0, 0, 0, 12, 0, 0, 0, 9, 0])
  assert.deepEqual([...geometry.getAttribute('normal')!.array], [0, 0, 1, 0, 0, 1, 0, 0, 1])
  const box = geometry.computeBoundingBox()
  assert.deepEqual(box.min.toArray(), [0, 0, 0])
  assert.deepEqual(box.max.toArray(), [12, 9, 0])
  const sphere = geometry.computeBoundingSphere()
  assert.deepEqual(sphere.center.toArray(), [6, 4.5, 0])
  assert.equal(sphere.radius, 7.5)
  geometry.center()
  assert.deepEqual(geometry.computeBoundingBox().getCenter().toArray(), [0, 0, 0])
  assert.equal(new Geometry().computeVertexNormals().hasAttribute('normal'), false)
})

test('geometry clones preserve independent attributes, morph targets and metadata', () => {
  const geometry = sheet().setIndex([2, 1, 0])
  geometry.name = 'panel'
  geometry.morphAttributes.position = [
    new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3),
  ]
  geometry.morphTargetsRelative = true
  geometry.userData = { nested: { id: 7 } }
  geometry.drawRange = { start: 1, count: 2 }
  geometry.addGroup(0, 3, 4)
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  geometry.recipe = { type: 'panel', args: [6, 3] }
  const copy = geometry.clone()
  assert.equal(copy.name, 'panel')
  assert.deepEqual(copy.drawRange, { start: 1, count: 2 })
  assert.deepEqual(copy.groups, geometry.groups)
  assert.equal(copy.morphTargetsRelative, true)
  assert.deepEqual(copy.userData, geometry.userData)
  assert.notEqual(copy.userData, geometry.userData)
  assert.notEqual(copy.groups[0], geometry.groups[0])
  assert.notEqual(copy.index!.array, geometry.index!.array)
  assert.notEqual(copy.boundingBox, geometry.boundingBox)
  assert.notEqual(copy.boundingSphere, geometry.boundingSphere)
  assert.deepEqual(copy.recipe, geometry.recipe)
  assert.notEqual(copy.recipe!.args, geometry.recipe!.args)
  copy.getAttribute('position')!.setX(0, 99)
  assert.equal(geometry.getAttribute('position')!.getX(0), 1)
  copy.morphAttributes.position[0].setZ(0, 9)
  assert.equal(geometry.morphAttributes.position[0].getZ(0), 1)
  const unindexed = geometry.toNonIndexed()
  assert.equal(unindexed.index, null)
  assert.deepEqual([...unindexed.getAttribute('position')!.array], [1, 5, 3, 7, 2, 3, 1, 2, 3])
  assert.deepEqual(unindexed.groups, [])
  const plain = sheet(),
    again = plain.toNonIndexed()
  assert.notEqual(plain.getAttribute('position')!.array, again.getAttribute('position')!.array)
  let releases = 0
  geometry.released.add(() => releases++)
  geometry.dispose()
  geometry.dispose()
  assert.equal(releases, 1)
  assert.equal(geometry._listeners.size, 0)
})

test('editing a triangle index notifies holders and preserves position-only bounds', () => {
  const geometry = new Geometry().setAttribute(
    'position',
    new BufferAttribute(new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 0]), 3),
  )
  const box = geometry.computeBoundingBox()
  const sphere = geometry.computeBoundingSphere()
  geometry.setIndex([0, 1, 2])
  assert.equal(geometry.boundingBox, box)
  assert.equal(geometry.boundingSphere, sphere)
  let notifications = 0
  geometry._listeners.add(() => notifications++)
  const version = geometry.version
  geometry.recipe = { type: 'triangle', args: [] }
  geometry.index!.array[0] = 2
  geometry.index!.needsUpdate = true
  assert.equal(geometry.version, version + 1)
  assert.equal(notifications, 1)
  assert.equal(geometry.recipe, null)
  assert.equal(geometry.boundingBox, box)
  assert.equal(geometry.boundingSphere, sphere)
})
