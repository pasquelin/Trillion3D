import test from 'node:test';
import assert from 'node:assert/strict';
import { Texture } from './texture.ts';
import { Vector2 } from '../math/vector2.ts';

test('default image sampling survives cloning and placement edits reach only placement revision', () => {
  const image = { width: 4, height: 8 };
  const texture = new Texture(image);
  const copy = texture.clone();
  assert.equal(copy.name, '');
  assert.deepEqual([copy.layout, copy.format], ['2d', 'rgba']);
  assert.deepEqual([copy.wrapS, copy.wrapT], ['clamp', 'clamp']);
  assert.deepEqual([copy.minFilter, copy.magFilter], ['linearMipLinear', 'linear']);
  assert.equal(copy.colorSpace, 'srgb');
  assert.equal(copy.flipY, true);
  assert.ok(copy.image === image);
  const version = texture.version,
    sampling = texture.sampling;
  texture.offset = new Vector2(0.25, 0.75);
  assert.deepEqual(texture.offset.toArray(), [0.25, 0.75]);
  assert.equal(texture.version, version);
  assert.equal(texture.sampling, sampling);
  assert.equal(texture.placement, 1);
  texture.repeat = new Vector2(2, 3);
  assert.equal(texture.placement, 2);
  assert.equal(texture.version, version);
  assert.equal(texture.sampling, sampling);
});

test('offset replacement releases its previous vector and does not duplicate subscriptions', () => {
  const texture = new Texture(null);
  const previous = texture.offset,
    next = new Vector2(0.2, 0.4);
  texture.offset = next;
  const before = texture.placement;
  previous.set(0.6, 0.8);
  assert.equal(texture.placement, before);
  next.set(0.1, 0.3);
  assert.equal(texture.placement, before + 1);
  texture.offset = next;
  assert.equal(texture.placement, before + 1);
});

test('explicit revision bookkeeping and symbol metadata remain silent', () => {
  const texture = new Texture(null);
  let notifications = 0;
  texture._listeners.add(() => notifications++);
  texture.version = 5;
  texture.sampling = 7;
  texture.placement = 11;
  const key = Symbol('host-data');
  Reflect.set(texture, key, { value: 42 });
  assert.deepEqual(Reflect.get(texture, key), { value: 42 });
  assert.deepEqual([texture.version, texture.sampling, texture.placement], [5, 7, 11]);
  assert.equal(notifications, 0);
});

test('an explicit image upload request notifies once and false does not request an upload', () => {
  const texture = new Texture(null);
  let notifications = 0;
  texture._listeners.add(() => notifications++);
  texture.needsUpdate = false;
  assert.equal(texture.version, 0);
  assert.equal(notifications, 0);
  texture.needsUpdate = true;
  assert.equal(texture.version, 1);
  assert.equal(notifications, 1);
  assert.equal(texture.needsUpdate, false);
  texture.needsUpdate = true;
  assert.equal(texture.version, 2);
  assert.equal(notifications, 2);
});
