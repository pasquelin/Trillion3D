import test from 'node:test';
import assert from 'node:assert/strict';
import { Material } from './material.ts';
import { Color } from '../math/color.ts';
import { Texture } from '../texture/texture.ts';

test('physical material records retain independent linear channels and supplied surface parameters', () => {
  const material = new Material(
    'meshStandard',
    {
      color: [0.2, 0.4, 0.6],
      emissive: [1, 0.5, 0.25],
      emissiveIntensity: 2,
      opacity: 0.3,
      metalness: 0.7,
      roughness: 0.8,
      side: 'double',
      alphaTest: 0.1,
      transparent: true,
    },
    { roughness: 0.2 },
  );
  assert.deepEqual(material.surface(), {
    baseColor: [0.2, 0.4, 0.6],
    emissive: [2, 1, 0.5],
    opacity: 0.3,
    metalness: 0.7,
    roughness: 0.8,
    side: 'double',
    alphaMode: 'blend',
    alphaCutoff: 0.1,
  });
  material.transparent = false;
  assert.equal(material.surface().alphaMode, 'mask');
  material.alphaTest = 0;
  assert.equal(material.surface().alphaMode, 'opaque');
  const copy = material.clone();
  assert.equal(copy.kind, 'meshStandard');
  assert.deepEqual(copy.surface(), material.surface());
  assert.notEqual(copy.color, material.color);
  copy.color.setRGB(0, 1, 0);
  assert.deepEqual(material.color.toArray(), [0.2, 0.4, 0.6]);
  const defaults = new Material('meshStandard', { roughness: undefined }, { roughness: 0.2 });
  assert.equal(defaults.roughness, 1);
});

test('materials hear shared Color instances and stop hearing replaced colors', () => {
  const color = new Color([0.1, 0.2, 0.3]);
  const material = new Material('meshStandard', { color });
  let writes = 0;
  material._listeners.add(() => writes++);
  color.setRGB(0.4, 0.5, 0.6);
  assert.equal(writes, 1);
  assert.deepEqual(material.surface().baseColor, [0.4, 0.5, 0.6]);
  const replacement = new Color([0.7, 0.8, 0.9]);
  material.color = replacement;
  const before = writes;
  color.setScalar(0);
  assert.equal(writes, before);
  replacement.setScalar(1);
  assert.equal(writes, before + 1);
  material.emissive = new Color([1, 0, 0]);
  const emissiveBefore = writes;
  material.emissive.setRGB(0, 1, 0);
  assert.equal(writes, emissiveBefore + 1);
  material.color = replacement;
  const repeated = writes;
  replacement.setRGB(0, 0, 1);
  assert.equal(writes, repeated + 1);
});

test('sampled textures notify material wearers while bookkeeping and disposal stay quiet', () => {
  const texture = new Texture({ width: 2, height: 3 });
  const material = new Material('meshStandard', { map: texture });
  let writes = 0;
  material._listeners.add(() => writes++);
  texture.rotation = 0.3;
  assert.equal(writes, 1);
  material.roughness = 0.4;
  assert.equal(writes, 2);
  material.version = 100;
  assert.equal(writes, 2);
  material.needsUpdate = true;
  assert.equal(writes, 3);
  assert.equal(material.needsUpdate, false);
  material.dispose();
  texture.rotation = 0.5;
  assert.equal(writes, 3);
});
