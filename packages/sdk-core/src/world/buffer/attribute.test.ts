import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BufferAttribute, InterleavedBuffer, InterleavedBufferAttribute } from './attribute.ts';
import { Geometry } from '../geometry/geometry.ts';

test('a cloned attribute owns a copy of its numbers, type, normalisation and name', () => {
  const source = new BufferAttribute(new Uint8Array([0, 128, 255]), 1, true, 'Uint8Array');
  source.name = 'shade';
  const copy = source.clone();
  assert.notEqual(copy.array, source.array);
  assert.deepEqual([...copy.array], [0, 128, 255]);
  assert.deepEqual([copy.normalized, copy.type, copy.name], [true, 'Uint8Array', 'shade']);
  assert.equal(copy.getX(2), 1, 'a normalised byte reads over 255');
  copy.setX(0, 0.5);
  assert.equal(copy.array[0], 128, 'a normalised write stores the byte');
  assert.equal(source.array[0], 0, 'the source keeps its numbers');
});

test('a written view bumps its buffer, which a reader compares to upload again', () => {
  const data = new InterleavedBuffer(new Float32Array([1, 2, 3, 9, 4, 5, 6, 9]), 4);
  const view = new InterleavedBufferAttribute(data, 3, 0);
  view.setXYZ(1, 7, 8, 9).needsUpdate = true;
  assert.equal(data.version, 1);
  assert.deepEqual([...data.array], [1, 2, 3, 9, 7, 8, 9, 9]);
  const own = view.clone();
  assert.ok(own instanceof BufferAttribute, 'a cloned view owns its numbers');
  assert.deepEqual([...own.array], [1, 2, 3, 7, 8, 9]);
  assert.deepEqual([...data.attribute(1, 3).array], [9, 9]);
});

test('a written attribute of a geometry tells the geometry, which drops its bounds', () => {
  const position = new BufferAttribute(new Float32Array([0, 0, 0, 1, 1, 1]), 3);
  const geometry = new Geometry().setAttribute('position', position);
  geometry.computeBoundingBox();
  const version = geometry.version;
  position.needsUpdate = true;
  assert.equal(position.version, 1);
  assert.equal(geometry.version, version + 1);
  assert.equal(geometry.boundingBox, null);
});

test('a normalised or interleaved element reads as the reference reads it', () => {
  const bytes = new Int16Array([32767, -32768, 12, 7, -5, 3000]);
  const [own, reference] = [
    new BufferAttribute(bytes, 3, true),
    new THREE.BufferAttribute(bytes, 3, true),
  ];
  const data = new Float32Array([1, 2, 3, 9, 4, 5, 6, 9]);
  const view = new InterleavedBufferAttribute(new InterleavedBuffer(data, 4), 3, 0);
  const tview = new THREE.InterleavedBufferAttribute(new THREE.InterleavedBuffer(data, 4), 3, 0);
  for (let i = 0; i < 2; i++)
    for (const get of ['getX', 'getY', 'getZ'] as const) {
      assert.equal(own[get](i), reference[get](i));
      assert.equal(view[get](i), tview[get](i));
    }
  assert.equal(view.count, tview.count);
});
