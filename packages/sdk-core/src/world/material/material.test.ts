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
  assert.equal(defaults.roughness, new Material('meshStandard').roughness);
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

test('every default color drives revision and wearer notifications when edited in place', () => {
  const material = new Material('meshStandard');
  let changes = 0;
  material._listeners.add(() => changes++);
  const before = material.version;
  material.color.setRGB(0.2, 0.3, 0.4);
  material.emissive.setRGB(0.4, 0.5, 0.6);
  material.subsurfaceColor.setRGB(0.6, 0.7, 0.8);
  assert.equal(material.version, before + 3);
  assert.equal(changes, 3);
  const marker = Symbol('host-material');
  Reflect.set(material, marker, 'owned');
  assert.equal(Reflect.get(material, marker), 'owned');
  assert.equal(changes, 4);
  material.version = 123;
  assert.equal(material.version, 123);
  assert.equal(changes, 4);
});

test('cloned materials own revisions, callbacks and color channels independently', () => {
  const source = new Material('meshPhong', { specular: new Color([0.2, 0.3, 0.4]) });
  let sourceChanges = 0,
    copyChanges = 0;
  source._listeners.add(() => sourceChanges++);
  source.version = 123;
  const copy = source.clone();
  assert.equal(copy.isMaterial, true);
  assert.equal(copy.kind, 'meshPhong');
  assert.equal(copy.version, 0);
  assert.notEqual(copy._listeners, source._listeners);
  copy._listeners.add(() => copyChanges++);
  copy.opacity = 0.4;
  assert.equal(copy.version, 1);
  assert.equal(source.version, 123);
  assert.equal(sourceChanges, 0);
  assert.equal(copyChanges, 1);
  (copy.specular as Color).setRGB(0.7, 0.8, 0.9);
  assert.deepEqual((source.specular as Color).toArray(), [0.2, 0.3, 0.4]);
  source.dispose();
  copy.roughness = 0.5;
  assert.equal(copyChanges, 3);
});

test('unobserved host metadata and optional texture listeners do not make assignment fail', () => {
  const material = new Material('meshBasic');
  const extension = { isTexture: true };
  material.map = extension;
  assert.equal(material.map, extension);
  material.map = null;
  assert.equal(material.map, null);
  const hostData = { _listeners: new Set<() => void>() };
  material.hostData = hostData;
  assert.equal(hostData._listeners.size, 0);
  const metadata = Symbol('host-texture');
  const texture = new Texture(null);
  Reflect.set(material, metadata, texture);
  const before = material.version;
  texture.rotation = 0.5;
  assert.equal(material.version, before);
});

test('reassigning a shared color preserves its existing notification order', () => {
  const color = new Color(0xffffff);
  const first = new Material('meshBasic', { color });
  const second = new Material('meshBasic', { color });
  const notifications: string[] = [];
  first._listeners.add(() => notifications.push('first'));
  second._listeners.add(() => notifications.push('second'));
  first.color = color;
  notifications.length = 0;
  color.setRGB(0.2, 0.3, 0.4);
  assert.deepEqual(notifications, ['first', 'second']);
});

test('a numeric constructor color remains observed through later channel edits', () => {
  const material = new Material('meshStandard', { color: 0x112233 });
  let changes = 0;
  material._listeners.add(() => changes++);
  material.color.setRGB(0.1, 0.2, 0.3);
  assert.equal(changes, 1);
  assert.deepEqual(material.surface().baseColor, [0.1, 0.2, 0.3]);
});

test('a color shared by two slots stays observed until both slots release it', () => {
  const color = new Color(0x123456),
    material = new Material('meshStandard', { color, emissive: color });
  let writes = 0;
  material._listeners.add(() => writes++);
  material.color = new Color(0xffffff);
  writes = 0;
  color.set(0x112233);
  assert.equal(writes, 1);
  assert.deepEqual(material.emissive.toArray(), color.toArray());
  material.emissive = new Color(0x111111);
  writes = 0;
  color.set(0xaabbcc);
  assert.equal(writes, 0);
});

test('a newly created optional color continues to notify its material after construction', () => {
  const material = new Material('meshPhong', { specular: 0x112233 });
  let writes = 0;
  material._listeners.add(() => writes++);
  (material.specular as Color).set(0x334455);
  assert.equal(writes, 1);
  material.sheenColor = 0xffaa00;
  writes = 0;
  (material.sheenColor as Color).set(0xff0000);
  assert.equal(writes, 1);
});
