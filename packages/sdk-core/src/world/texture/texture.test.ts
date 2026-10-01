import test from 'node:test';
import assert from 'node:assert/strict';
import { Texture } from './texture.ts';
import { Vector2 } from '../math/vector2.ts';

test('textures classify image, sampling and placement edits and propagate vector changes', () => {
  const texture = new Texture({ width: 7, height: 11 });
  let writes = 0;
  texture._listeners.add(() => writes++);
  assert.deepEqual([texture.width, texture.height], [7, 11]);
  const sampling = texture.sampling;
  texture.wrap = 'repeat';
  assert.equal(texture.wrapS, 'repeat');
  assert.equal(texture.wrapT, 'repeat');
  assert.equal(texture.wrap, 'repeat');
  assert.ok(texture.sampling > sampling);
  for (const [key, value] of [
    ['wrapS', 'mirror'],
    ['wrapT', 'clamp'],
    ['minFilter', 'nearest'],
    ['magFilter', 'nearest'],
    ['anisotropy', 4],
  ] as const) {
    const before = texture.sampling;
    (texture as any)[key] = value;
    assert.equal(texture.sampling, before + 1);
  }
  const placement = texture.placement;
  texture.repeat.set(2, 3);
  texture.offset.set(0.2, 0.3);
  texture.rotation = 0.5;
  assert.equal(texture.placement, placement + 3);
  const old = texture.repeat,
    replacement = new Vector2(4, 5);
  texture.repeat = replacement;
  const replaced = texture.placement;
  old.set(6, 7);
  assert.equal(texture.placement, replaced);
  replacement.x = 8;
  assert.equal(texture.placement, replaced + 1);
  texture.repeat = replacement;
  assert.equal(texture.placement, replaced + 1);
  const version = texture.version;
  texture.image = { width: 3, height: 4 };
  assert.equal(texture.version, version + 1);
  assert.deepEqual([texture.width, texture.height], [3, 4]);
  texture.version = 50;
  assert.equal(texture.version, 50);
  const before = writes;
  texture.dispose();
  texture.rotation = 1;
  assert.equal(writes, before);
});

test('clones share the image but own placement vectors and preserve complete sampler settings', () => {
  const image = { width: 3, height: 5 };
  const texture = new Texture(image, 'array', 'r');
  Object.assign(texture, {
    name: 'mask',
    wrapS: 'repeat',
    wrapT: 'mirror',
    rotation: 0.3,
    minFilter: 'nearest',
    magFilter: 'nearest',
    colorSpace: 'linear',
    flipY: false,
    anisotropy: 4,
    channel: 1,
  });
  texture.repeat.set(2, 3);
  texture.offset.set(0.4, 0.5);
  const copy = texture.clone();
  assert.notEqual(copy.id, texture.id);
  assert.equal(copy.image, image);
  for (const key of [
    'name',
    'layout',
    'format',
    'wrapS',
    'wrapT',
    'rotation',
    'minFilter',
    'magFilter',
    'colorSpace',
    'flipY',
    'anisotropy',
    'channel',
  ])
    assert.equal((copy as any)[key], (texture as any)[key], key);
  assert.deepEqual(copy.repeat.toArray(), [2, 3]);
  assert.deepEqual(copy.offset.toArray(), [0.4, 0.5]);
  copy.repeat.set(7, 8);
  assert.deepEqual(texture.repeat.toArray(), [2, 3]);
  assert.deepEqual([new Texture(null).width, new Texture(null).height], [0, 0]);
});

test('placement edits reach only the placement revision', () => {
  const texture = new Texture({ width: 4, height: 8 });
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
