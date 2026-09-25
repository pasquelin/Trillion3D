/**
 * The proof that the prepared scene built from the cache tables is the scene the host loader built
 * from the compiled document: on every cache the repository compiles, and for each document it
 * lays out (`source.gltf`, and the autonomous `scene.gltf` where one is written), the two graphs
 * are walked side by side and must agree on every object, pose, name, geometry byte, bound,
 * surface field, sampler and light the engine or a host renderer reads. The prepared scene is the
 * engine's own graph: it is compared twice — field by field on what the engine reads of it, and
 * whole through the copy the reference renderer draws (`../three/fromGraphNodes.ts`).
 *
 * The loader is the witness here and only here, to prove it has nothing left to read. Images are
 * decoded by a stand-in answering the size of the bytes given, so both sides compare the same files.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { type ClusterManifest } from '../../../../sdk-core/src/index.ts';
import { assertSceneTables } from '../../../../sdk-core/src/scene/core/tableContracts.ts';
import { buildPreparedScene } from './build.ts';
import { threeGraph } from '../../../../../bench/witnesses/three/fromGraphNodes.ts';
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';
import {
  caches,
  describe,
  describeShape,
  repository,
  serveFiles,
  type Ranks,
} from './scenes.fixture.ts';

async function witness(folder: URL, document: string, text?: string) {
  text ??= await readFile(new URL(document, folder), 'utf8');
  const gltf = await new GLTFLoader().parseAsync(text, folder.href);
  const associations = gltf.parser.associations as Map<object, ReturnType<Ranks>>;
  const ranks: Ranks = (object) => associations.get(object);
  return { shape: describeShape(gltf.scene, ranks), whole: describe(gltf.scene, () => undefined) };
}

async function prepared(folder: URL, document: string, written?: unknown) {
  const tables = assertSceneTables(
    written ?? JSON.parse(await readFile(new URL('scene-tables.json', folder), 'utf8')),
  );
  const built = await buildPreparedScene({
    tables,
    metadata: {} as ClusterManifest,
    sceneFile: document,
    base: folder.href,
    skipBaked: false,
    signal: undefined,
    track: (_resource, read) => read,
  });
  const meshes = built.associations as Map<object, ReturnType<Ranks>>;
  const textures = built.textureIndices as Map<object, number>;
  const ranks: Ranks = (object) =>
    textures.has(object) ? { textures: textures.get(object) } : meshes.get(object);
  const source = built.source as unknown as Object3D;
  return {
    shape: describeShape(source, ranks),
    whole: describe(threeGraph(source), () => undefined),
  };
}

test('the scene built from the tables is the scene the loader built, on every compiled cache', async (t) => {
  serveFiles(t);
  const folders = await caches();
  assert.ok(folders.length >= 10, 'the compiled caches are found');
  for (const folder of folders) {
    // A partitioned cache draws its placements from rows, not nodes: `partition.test.ts` proves
    // them against the loader's.
    const tables = JSON.parse(await readFile(new URL('scene-tables.json', folder), 'utf8'));
    if (tables.partition) continue;
    for (const document of ['source.gltf', 'scene.gltf']) {
      const exists = await readFile(new URL(document, folder)).then(
        () => true,
        () => false,
      );
      if (!exists) continue;
      assert.deepEqual(
        await prepared(folder, document),
        await witness(folder, document),
        `${relative(fileURLToPath(repository), fileURLToPath(folder))}/${document}`,
      );
    }
  }
});

/** A slot as the tables write it: the texture, the set sampled, the slot's own, the transform. */
const slot = (texture: number, texCoord: number, slotTexCoord: number, moved = false) => ({
  texture,
  texCoord,
  slotTexCoord,
  transform: { offset: moved ? [0.25, 0.5] : null, rotation: null, scale: null },
});

test('a slot whose transform names another set keeps the texture and the rank the loader gives it', async (t) => {
  serveFiles(t);
  const folder = (await caches()).find((one) => one.pathname.includes('/marble-bust/'))!;
  const gltf = JSON.parse(await readFile(new URL('source.gltf', folder), 'utf8'));
  const tables = JSON.parse(await readFile(new URL('scene-tables.json', folder), 'utf8'));
  const transform = (texCoord?: number, moved = false) => ({
    KHR_texture_transform: { texCoord, ...(moved ? { offset: [0.25, 0.5] } : {}) },
  });
  // Own set 1 sent back to 0: two copies, no rank. Own set 0 sent to 1: one copy, the rank kept.
  // Own set 1 named again: one copy, no rank. Own set 0 moved: one copy, the rank kept.
  const [material] = gltf.materials,
    pbr = material.pbrMetallicRoughness;
  gltf.extensionsUsed = ['KHR_texture_transform'];
  material.normalTexture = { index: 0, texCoord: 1, extensions: transform(0) };
  pbr.baseColorTexture = { index: 1, extensions: transform(1) };
  pbr.metallicRoughnessTexture = { index: 2, texCoord: 1, extensions: transform(1) };
  material.occlusionTexture = { index: 2, extensions: transform(undefined, true) };
  Object.assign(tables.materials[0], {
    normalMap: slot(0, 0, 1),
    map: slot(1, 1, 0),
    metalnessMap: slot(2, 1, 1),
    roughnessMap: slot(2, 1, 1),
    aoMap: slot(2, 0, 0, true),
  });
  assert.deepEqual(
    await prepared(folder, 'source.gltf', tables),
    await witness(folder, 'source.gltf', JSON.stringify(gltf)),
  );
});
