/**
 * The proof that the prepared scene built from the cache tables is the scene the host loader built
 * from the published document: on every cache the repository publishes, and for each document it
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
import { fileURLToPath, pathToFileURL } from 'node:url';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { type ClusterManifest } from '../../../../sdk-core/src/index.ts';
import { assertSceneTables } from '../../../../sdk-core/src/scene/core/tableContracts.ts';
import { buildPreparedScene } from './build.ts';
import { threeGraph } from '../three/fromGraphNodes.ts';
import type { GraphNode } from '../graph/node.ts';
import { caches, describe, describeShape, serveFiles, type Ranks } from './scenes.fixture.ts';

async function witness(folder: URL, document: string) {
  const text = await readFile(new URL(document, folder), 'utf8');
  const gltf = await new GLTFLoader().parseAsync(text, folder.href);
  const associations = gltf.parser.associations as Map<object, ReturnType<Ranks>>;
  const ranks: Ranks = (object) => associations.get(object);
  return { shape: describeShape(gltf.scene, ranks), whole: describe(gltf.scene, () => undefined) };
}

async function prepared(folder: URL, document: string) {
  const tables = assertSceneTables(
    JSON.parse(await readFile(new URL('scene-tables.json', folder), 'utf8')),
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
  const source = built.source as unknown as GraphNode;
  return {
    shape: describeShape(source, ranks),
    whole: describe(threeGraph(source), () => undefined),
  };
}

test('the scene built from the tables is the scene the loader built, on every published cache', async (t) => {
  serveFiles(t);
  const folders = await caches();
  assert.ok(folders.length >= 10, 'the published caches are found');
  for (const folder of folders)
    for (const document of ['source.gltf', 'scene.gltf']) {
      const exists = await readFile(new URL(document, folder)).then(
        () => true,
        () => false,
      );
      if (!exists) continue;
      assert.deepEqual(
        await prepared(folder, document),
        await witness(folder, document),
        `${pathToFileURL(fileURLToPath(folder)).pathname.split('site/assets/')[1]}${document}`,
      );
    }
});
