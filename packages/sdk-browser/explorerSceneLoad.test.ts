import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { loadPreparedScene } from './explorerScene.ts';
import type { ClusterManifest } from '../sdk-core/index.ts';

const manifest = { primitives: [] } as unknown as ClusterManifest;
/** The cache's scene tables, describing a scene that draws nothing: what both loads check against. */
const emptyTables = () =>
  Response.json({
    version: 1,
    nodeTableVersion: 1,
    materialTableVersion: 1,
    nodes: [],
    materials: [],
    textures: [],
  });

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
  // The document the parser read, as it carries it: three image records, two of which name one
  // file — the fold the loader applies, which the prepared-scene check reads from `json`.
  const json = { images: [{ uri: 'box1.png' }, { uri: 'box2.png' }, { uri: 'box1.png' }] };
  t.mock.method(GLTFLoader.prototype, 'loadAsync', async () => ({
    scene,
    parser: { associations, json },
  }));
  t.mock.method(globalThis, 'fetch', async () => emptyTables());
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

/**
 * Behaviour: with no `textureSource` given, a cache that bakes texture chains has its images
 * skipped by the loader. The engine reads the baked levels whatever the option says, so fetching
 * and decoding the source images would buy nothing; only a host that names `'host'` — because a
 * backend of its session draws the host scene — still gets them. The loader is told which of the
 * two it is: `prepareExplorer` resolves the option against the backends it chose before calling
 * this function (`resolveTextureSource`, covered by `defaultBackendsTextureSource.test.ts`).
 */
const bakedCache = {
  primitives: [],
  textures: { url: 'textures/v4' },
  texturePreviews: [{ image: 0, firstLevel: 0, bakedLevels: 0 }],
} as unknown as ClusterManifest;

async function loadWith(t: TestContext, textureSource?: 'host' | 'cache') {
  const taken: string[] = [];
  const answer = { scene: new THREE.Group(), parser: { associations: new Map() } };
  t.mock.method(GLTFLoader.prototype, 'loadAsync', async () => {
    taken.push('loadAsync');
    return answer;
  });
  t.mock.method(GLTFLoader.prototype, 'parseAsync', async () => {
    taken.push('parseAsync');
    return answer;
  });
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) =>
    String(input).endsWith('scene.gltf')
      ? new Response('{"images":[{"uri":"a.png"}]}')
      : emptyTables(),
  );
  await loadPreparedScene(
    { manifestUrl: 'scene.gltf', ...(textureSource ? { textureSource } : {}) },
    bakedCache,
    'scene.gltf',
    'http://localhost/',
    'full',
    false,
    undefined,
    () => {},
    () => {},
  );
  return taken;
}

test('the loader skips the baked images by default and reads them only when the host says host', async (t) => {
  assert.deepEqual(await loadWith(t), ['parseAsync']);
  assert.deepEqual(await loadWith(t, 'cache'), ['parseAsync']);
  assert.deepEqual(await loadWith(t, 'host'), ['loadAsync']);
});
