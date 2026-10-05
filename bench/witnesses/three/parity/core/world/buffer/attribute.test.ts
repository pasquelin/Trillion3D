import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  BufferAttribute,
  InterleavedBuffer,
  InterleavedBufferAttribute,
  pendingAttribute,
  pendingInterleaved,
} from '../../../../../../../packages/sdk-core/src/world/buffer/attribute.ts';
import { Geometry } from '../../../../../../../packages/sdk-core/src/world/geometry/geometry.ts';

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

test('a normalised or interleaved element reads as the host rule reads it', () => {
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

test('a component past the vertex reads 0, never the next vertex', () => {
  const flat = new BufferAttribute(new Float32Array([1, 2, 3, 4]), 2);
  assert.deepEqual([flat.getComponent(0, 2), flat.getZ(0), flat.getW(0)], [0, 0, 0]);
  assert.equal(flat.getComponent(1, 1), 4);
});

test('deferred buffers expose counts before loading, share concurrent reads and retain loaded numbers', async () => {
  let calls = 0;
  const array = new Float32Array([1, 2, 3, 4, 5, 6]);
  const attribute = pendingAttribute(
    {
      length: 6,
      type: 'Float32Array',
      read: async () => {
        calls++;
        return array;
      },
    },
    3,
    true,
  );
  assert.equal(attribute.count, 2);
  assert.equal(attribute.type, 'Float32Array');
  assert.equal(attribute.normalized, true);
  assert.throws(
    () => attribute.array,
    (error: any) => error.code === 'VERTICES_NOT_LOADED',
  );
  await Promise.all([attribute._load(), attribute._load()]);
  assert.equal(calls, 1);
  assert.equal(attribute.array, array);
  assert.equal(attribute._pending, null);
  await attribute._load();
  assert.equal(calls, 1);
  const buffer = pendingInterleaved(
    { length: 6, type: 'Float32Array', read: async () => array },
    3,
  );
  assert.equal(buffer.count, 2);
  assert.throws(
    () => buffer.array,
    (error: any) => error.code === 'VERTICES_NOT_LOADED',
  );
  await buffer._load();
  assert.equal(buffer.array, array);
});

test('a failed deferred read is retried rather than caching a rejected promise', async () => {
  let calls = 0;
  const failure = new Error('network'),
    array = new Float32Array([1, 2, 3]);
  const attribute = pendingAttribute(
    {
      length: 3,
      type: 'Float32Array',
      read: async () => {
        if (++calls === 1) throw failure;
        return array;
      },
    },
    3,
    false,
  );
  await assert.rejects(attribute._load(), (error) => error === failure);
  assert.equal(attribute.count, 1);
  await attribute._load();
  assert.equal(calls, 2);
  assert.equal(attribute.array, array);
});
