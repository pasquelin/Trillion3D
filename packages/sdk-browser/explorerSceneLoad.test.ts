import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { loadPreparedScene } from './explorerScene.ts';
import type { ClusterManifest } from '../sdk-core/index.ts';

const manifest = { primitives: [] } as unknown as ClusterManifest;

// Behaviour 13: `textureIndices` covers every texture the glTF associates with a rank, and nothing
// else — not objects that are not textures, nor an association without a texture rank.
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
  // The cache's scene tables are read at load and checked against the scene: this one draws
  // nothing, so the tables that describe it are empty.
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({
      version: 1,
      nodeTableVersion: 1,
      materialTableVersion: 1,
      nodes: [],
      materials: [],
      textures: [],
    }),
  );
  const result = await loadPreparedScene(
    { manifestUrl: 'scene.gltf' },
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
