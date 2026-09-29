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
import { readdir, readFile } from 'node:fs/promises';
import type * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { ClusterManifest } from '../../../../sdk-core/src/index.ts';
import { fetchVerified } from '../../cluster/pages.ts';
import { loadPreparedSceneTables } from '../../scene/tables.ts';
import { createPartitionCells } from '../../scene/partition/cells.ts';
import { io, noBudget, settled } from '../../scene/partition/cells.fixture.ts';
import {
  readCellPage,
  type TableCell,
} from '../../../../sdk-core/src/scene/core/tablePartition.ts';
import { isDrawnNode } from '../graph/kinds.ts';
import { hostWorldChainInto } from '../world/chain.ts';
import { hostWorldBounds } from '../world/bounds.ts';
import { pagesBounds } from '../../world/scene/pagesBounds.ts';
import { buildPreparedScene } from './build.ts';
import { caches, serveFiles } from './scenes.fixture.ts';

/** One drawn placement: mesh rank, primitive rank and world matrix, as one comparable line. */
const line = (mesh: number, primitive: number, world: ArrayLike<number>) =>
  `${mesh}/${primitive} ${Array.from(world).join(',')}`;

/** The published partitioned cache, built from its tables and the pages of their partition. */
async function partitioned(t: TestContext) {
  serveFiles(t);
  const folder = (await caches()).find((one) => one.pathname.includes('/ten-thousand-objects/'))!;
  const { tables } = await loadPreparedSceneTables(folder.href);
  assert.ok(tables.partition && tables.partition.pages.length > 0, 'the cache is partitioned');
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
  // Every page and cell of the folder at hand: a reach past everything reads them all.
  const files = new Map<string, Uint8Array>();
  for (const name of await readdir(folder))
    if (name.startsWith('scene-'))
      files.set(new URL(name, folder).href, await readFile(new URL(name, folder)));
  const port = io((url) => files.get(url)!);
  for (const url of files.keys()) port.held.add(url);
  await settled(cells, [0, 0, 0], Infinity, port.port, noBudget);
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

// Read through the root's pages (#750), the cells are every cell file of the folder, in order.
test('the paged tables give back every cell file of the folder, in order', async (t) => {
  const { folder, partition } = await partitioned(t);
  const files = (await readdir(folder)).filter((name) => name.startsWith('scene-cell-'));
  const cells = files.map((_, at) => `scene-cell-${at}.json`);
  const records = async (slots: typeof partition.pages): Promise<TableCell[]> => {
    const lists = await Promise.all(
      slots.map(async ({ page }) => {
        const body = readCellPage(await readFile(new URL(page.url, folder)), page.url);
        return body.pages ? records(body.pages) : body.cells;
      }),
    );
    return lists.flat();
  };
  const read = await records(partition.pages);
  assert.deepEqual(
    read.map((cell) => cell.url),
    cells,
  );
  // Each at the size and fingerprint its record announces: the runtime's own check passes.
  for (const cell of read) await fetchVerified(new URL(cell.url, folder).href, cell);
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
