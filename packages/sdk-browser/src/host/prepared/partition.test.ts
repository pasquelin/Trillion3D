/**
 * The proof that a partitioned cache places what the host loader placed (#404): on the published
 * cache whose placements outgrow one cell (`site/assets/examples/ten-thousand-objects`), every
 * cell read, the core's drawn meshes and the live rows together are the loader's meshes — each
 * mesh and primitive rank at the loader's world matrix, bit for bit. The loader is the witness
 * here and only here. The rest of the scene — surfaces, samplers, lights — is proven on every
 * other cache by `build.test.ts`, from the same builders.
 */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { ClusterManifest } from '../../../../sdk-core/src/index.ts';
import { assertSceneTables } from '../../../../sdk-core/src/scene/core/tableContracts.ts';
import { createPartitionCells } from '../../scene/partition/cells.ts';
import { isDrawnNode } from '../graph/kinds.ts';
import { hostWorldChainInto } from '../world/chain.ts';
import { hostWorldBounds } from '../world/bounds.ts';
import { pagesBounds } from '../../world/scene/pagesBounds.ts';
import { buildPreparedScene } from './build.ts';
import { caches, serveFiles } from './scenes.fixture.ts';

/** One drawn placement: mesh rank, primitive rank and world matrix, as one comparable line. */
const line = (mesh: number, primitive: number, world: ArrayLike<number>) =>
  `${mesh}/${primitive} ${Array.from(world).join(',')}`;

/** The published partitioned cache, built from its tables. */
async function partitioned(t: TestContext) {
  serveFiles(t);
  const folder = (await caches()).find((one) => one.pathname.includes('/ten-thousand-objects/'))!;
  const tables = assertSceneTables(
    JSON.parse(await readFile(new URL('scene-tables.json', folder), 'utf8')),
  );
  assert.ok(tables.partition && tables.partition.cells.length > 1, 'the cache is partitioned');
  const built = await buildPreparedScene({
    tables,
    metadata: {} as ClusterManifest,
    sceneFile: 'source.gltf',
    base: folder.href,
    skipBaked: false,
    signal: undefined,
    track: (_resource, read) => read,
  });
  return { folder, partition: tables.partition, built };
}

test('a partitioned cache places every mesh the loader placed, at its world matrix', async (t) => {
  const { folder, partition, built } = await partitioned(t);
  const cells = createPartitionCells({
    partition,
    base: folder.href,
    root: built.source,
    parents: built.nodes,
    meshes: built.placed,
  });
  const read = async (url: string) => new Uint8Array(await readFile(fileURLToPath(url)));
  await cells.prime([0, 0, 0], Infinity, read, true);
  const prepared: string[] = [];
  built.source.traverse((node) => {
    const link = built.associations.get(node);
    if (!isDrawnNode(node) || !link) return;
    const rows = link.placements;
    if (!rows)
      prepared.push(
        line(link.meshes!, link.primitives ?? 0, hostWorldChainInto(new Float64Array(16), node)),
      );
    else
      for (let at = 0; at < rows.capacity; at++)
        if (rows.live[at])
          prepared.push(
            line(link.meshes!, link.primitives!, rows.matrices.subarray(at * 16, at * 16 + 16)),
          );
  });
  const gltf = await new GLTFLoader().parseAsync(
    await readFile(new URL('source.gltf', folder), 'utf8'),
    folder.href,
  );
  gltf.scene.updateMatrixWorld(true);
  const ranks = gltf.parser.associations as Map<object, { meshes?: number; primitives?: number }>;
  const witness: string[] = [];
  gltf.scene.traverse((object) => {
    const rank = ranks.get(object);
    if ((object as THREE.Mesh).isMesh && rank?.meshes !== undefined)
      witness.push(line(rank.meshes, rank.primitives ?? 0, object.matrixWorld.elements));
  });
  assert.equal(prepared.length, witness.length, 'as many placements');
  assert.deepEqual(prepared.sort(), witness.sort());
});

// Framing and a loaded model's bounds take the whole world, whichever cells are read: each mesh
// placed by rows bounds itself by the box around every cell, host bounds and page bounds alike.
test('a mesh placed by rows bounds the whole partition, never its own pose', async (t) => {
  const { partition, built } = await partitioned(t);
  const expected = [...partition.bounds];
  assert.deepEqual([...hostWorldBounds(built.source)], expected);
  const primitives = [...built.placed.keys()].map((mesh) => ({
    mesh,
    primitive: 0,
    pages: [{ role: 'exact', min: [0, 0, 0], max: [1e9, 1e9, 1e9] }],
  }));
  const metadata = { primitives } as unknown as ClusterManifest;
  assert.deepEqual(
    [...pagesBounds(built.source, built.associations, metadata, () => {})],
    expected,
  );
});
