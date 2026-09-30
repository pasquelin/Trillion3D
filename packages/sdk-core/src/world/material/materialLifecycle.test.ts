import test from 'node:test';
import assert from 'node:assert/strict';
import { Material } from './material.ts';
import { Color } from '../math/color.ts';
import { Texture } from '../texture/texture.ts';

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
