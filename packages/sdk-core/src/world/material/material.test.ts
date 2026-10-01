import test from 'node:test';
import assert from 'node:assert/strict';
import { Material } from './material.ts';
import { Color } from '../math/color.ts';
import { Texture } from '../texture/texture.ts';
import { side, blending } from '../constants/index.ts';

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

test('a texture a material no longer samples stops repainting it, unless another field still holds it', () => {
  const texture = new Texture({ width: 2, height: 2 });
  const material = new Material('meshStandard', { map: texture, emissiveMap: texture });
  let writes = 0;
  material._listeners.add(() => writes++);
  material.map = null;
  writes = 0;
  texture.rotation = 0.1;
  assert.equal(writes, 1, 'still sampled as the emissive map');
  material.emissiveMap = new Texture(null);
  writes = 0;
  texture.rotation = 0.2;
  assert.equal(writes, 0, 'sampled by no field');
});

test('a new material is an opaque front face, blended normally, depth-tested and depth-writing', () => {
  const material = new Material('meshStandard');
  assert.equal(material.surface().alphaMode, 'opaque');
  assert.equal(material.surface().side, side.front);
  assert.equal(material.blending, blending.normal);
  assert.equal(material.depthTest && material.depthWrite, true);
  assert.equal(material.vertexColors || material.transparentShadow, false, 'opt-in only');
});

test('a parameter given as undefined is not given', () => {
  const bare = new Material('meshStandard');
  assert.equal(new Material('meshStandard', { roughness: undefined }).roughness, bare.roughness);
});

test('a clone is heard by its own wearers alone', () => {
  const source = new Material('meshPhong', { specular: 0x112233 });
  let heard = 0;
  source._listeners.add(() => heard++);
  const copy = source.clone();
  copy.color.setRGB(0.1, 0.2, 0.3);
  (copy.specular as Color).setRGB(0.3, 0.2, 0.1);
  assert.equal(heard, 0);
});
