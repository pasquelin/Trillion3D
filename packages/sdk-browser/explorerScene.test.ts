import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { loadPreparedScene } from './explorerScene.ts';
import type { ClusterManifest } from '../sdk-core/index.ts';

const manifest = { primitives: [] } as unknown as ClusterManifest;

// Comportement 13 : `textureIndices` couvre chaque texture que le glTF associe à un rang, et rien
// d'autre — ni les objets qui ne sont pas des textures, ni une association sans rang de texture.
test('loadPreparedScene indexes every glTF texture association and nothing else', async (t) => {
  const scene = new THREE.Group();
  const [textureA, textureB, textureC] = [
    new THREE.Texture(),
    new THREE.Texture(),
    new THREE.Texture(),
  ];
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
  const associations = new Map<object, { textures?: number; meshes?: number }>([
    [textureA, { textures: 0 }],
    [textureB, { textures: 2 }],
    [textureC, {}],
    [mesh, { meshes: 0 }],
  ]);
  t.mock.method(GLTFLoader.prototype, 'loadAsync', async () => ({
    scene,
    parser: { associations },
  }));
  const result = await loadPreparedScene(
    {},
    manifest,
    'scene.gltf',
    'http://localhost/',
    'full',
    false,
    undefined,
    () => {},
    () => {},
  );
  assert.equal(result.textureIndices.size, 2);
  assert.equal(result.textureIndices.get(textureA), 0);
  assert.equal(result.textureIndices.get(textureB), 2);
  assert.equal(result.textureIndices.has(textureC), false);
});
