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
