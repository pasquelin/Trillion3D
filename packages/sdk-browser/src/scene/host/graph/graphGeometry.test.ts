/**
 * The engine's own geometry owns its buffers when copied, and a triangle list spells every corner
 * and normalised attribute.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { BufferAttribute } from '../../../../../sdk-core/src/world/buffer/attribute.ts'
import { Geometry } from '../../../../../sdk-core/src/world/geometry/geometry.ts'

test('a copied geometry owns its buffers, and a triangle list spells every corner', () => {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]),
    order = new Uint16Array([0, 1, 2, 2, 1, 3]),
    shades = new Uint8Array([0, 64, 128, 255])
  const geometry = new Geometry().setIndex(new BufferAttribute(order, 1))
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('shade', new BufferAttribute(shades, 1, true))
  const copy = geometry.clone()
  assert.notEqual(copy.attributes.position.array, positions, 'the copy owns its positions')
  assert.deepEqual([...copy.index!.array], [...order])
  const flat = geometry.toNonIndexed()
  assert.equal(flat.index, null)
  // Corners 0, 1, 2 then 2, 1, 3, each spelt out.
  const expected = {
    position: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 1, 0],
    shade: [0, 64, 128, 128, 64, 255],
  }
  for (const name of ['position', 'shade'] as const) {
    assert.deepEqual([...flat.attributes[name].array], expected[name], name)
    assert.equal(flat.attributes[name].normalized, name === 'shade', name)
  }
  assert.equal(flat.attributes.position.array.constructor, Float32Array)
  assert.equal(flat.attributes.shade.array.constructor, Uint8Array)
})
