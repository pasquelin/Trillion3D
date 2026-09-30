import test from 'node:test';
import assert from 'node:assert/strict';
import { Geometry } from './geometry.ts';
import { BufferAttribute } from '../buffer/attribute.ts';

test('new geometry declares its public resource identity and complete default draw range', () => {
  const geometry = new Geometry();
  assert.equal(geometry.type, 'Geometry');
  assert.equal(geometry.name, '');
  assert.equal(geometry.usage, 'static');
  assert.deepEqual(geometry.drawRange, { start: 0, count: Infinity });
});

test('editing a triangle index notifies holders and preserves position-only bounds', () => {
  const geometry = new Geometry().setAttribute(
    'position',
    new BufferAttribute(new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 0]), 3),
  );
  const box = geometry.computeBoundingBox();
  const sphere = geometry.computeBoundingSphere();
  geometry.setIndex([0, 1, 2]);
  assert.equal(geometry.boundingBox, box);
  assert.equal(geometry.boundingSphere, sphere);
  let notifications = 0;
  geometry._listeners.add(() => notifications++);
  const version = geometry.version;
  geometry.recipe = { type: 'triangle', args: [] };
  geometry.index!.array[0] = 2;
  geometry.index!.needsUpdate = true;
  assert.equal(geometry.version, version + 1);
  assert.equal(notifications, 1);
  assert.equal(geometry.recipe, null);
  assert.equal(geometry.boundingBox, box);
  assert.equal(geometry.boundingSphere, sphere);
});
