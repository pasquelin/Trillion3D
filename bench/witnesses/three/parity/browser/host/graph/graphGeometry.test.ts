/**
 * The engine's own geometry holds the host library's numbers: the same bounds, morph targets
 * included, the same buffers owned by a copy, and the same corners and normalised attributes spelt
 * out of a triangle list. Each rule is checked against the host library.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { BufferAttribute } from '../../../../../../../packages/sdk-core/src/world/buffer/attribute.ts'
import { Geometry } from '../../../../../../../packages/sdk-core/src/world/geometry/geometry.ts'

test('a geometry bounds itself by the rule of the engine, morph targets included', () => {
  const positions = new Float32Array([0, 0, 0, 1, 2, 3, -4, 0.5, 2])
  const morph = new Float32Array([0.5, -1, 0, 0, 0, 2, 1, 1, 1])
  const geometry = new Geometry().setAttribute('position', new BufferAttribute(positions, 3))
  geometry.morphAttributes.position = [new BufferAttribute(morph, 3)]
  // A relative target is bounded vertex by vertex, tighter than a box on box
  // (geometry.test.ts): the comparison here is on an absolute one.
  geometry.morphTargetsRelative = false
  const reference = new THREE.BufferGeometry()
  reference.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  reference.morphAttributes.position = [new THREE.BufferAttribute(morph, 3)]
  reference.morphTargetsRelative = false
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  reference.computeBoundingBox()
  reference.computeBoundingSphere()
  assert.deepEqual(
    [...geometry.boundingBox!.min.toArray(), ...geometry.boundingBox!.max.toArray()],
    [...reference.boundingBox!.min.toArray(), ...reference.boundingBox!.max.toArray()],
  )
  assert.deepEqual(
    [...geometry.boundingSphere!.center.toArray(), geometry.boundingSphere!.radius],
    [...reference.boundingSphere!.center.toArray(), reference.boundingSphere!.radius],
  )
})

test('a copied geometry owns its buffers, and a triangle list spells every corner', () => {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]),
    order = new Uint16Array([0, 1, 2, 2, 1, 3]),
    shades = new Uint8Array([0, 64, 128, 255])
  const geometry = new Geometry().setIndex(new BufferAttribute(order, 1))
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('shade', new BufferAttribute(shades, 1, true))
  const reference = new THREE.BufferGeometry().setIndex(new THREE.BufferAttribute(order, 1))
  reference.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  reference.setAttribute('shade', new THREE.BufferAttribute(shades, 1, true))
  const copy = geometry.clone()
  assert.notEqual(copy.attributes.position.array, positions, 'the copy owns its positions')
  assert.deepEqual([...copy.index!.array], [...order])
  const flat = geometry.toNonIndexed(),
    expected = reference.toNonIndexed()
  assert.equal(flat.index, null)
  for (const name of ['position', 'shade']) {
    assert.deepEqual([...flat.attributes[name].array], [...expected.attributes[name].array], name)
    assert.equal(flat.attributes[name].normalized, expected.attributes[name].normalized, name)
    assert.equal(
      flat.attributes[name].array.constructor,
      expected.attributes[name].array.constructor,
    )
  }
})
