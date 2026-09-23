import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { writeGarden } from './docs/garden-source.ts';
const root = resolve(import.meta.dirname, '..');

interface GardenGltf {
  nodes: unknown[];
  meshes: { primitives: { attributes: { POSITION: number } }[] }[];
  accessors: { count: number }[];
}

interface CachePointer {
  url: string;
  formatVersion: string;
}

interface CacheManifest {
  sourceTriangles: number;
  formatVersion: string;
}

test('the published original garden matches its deterministic source generator', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'trillion3d-garden-'));
  try {
    await writeGarden(temporary);
    for (const file of ['garden.gltf', 'garden.bin']) {
      assert.deepEqual(
        await readFile(join(temporary, file)),
        await readFile(join(root, 'site/assets/kinetic-garden/source', file)),
      );
    }
    const gltf = JSON.parse(await readFile(join(temporary, 'garden.gltf'), 'utf8')) as GardenGltf;
    const triangles = gltf.meshes.reduce(
      (total, mesh) => total + gltf.accessors[mesh.primitives[0].attributes.POSITION].count / 3,
      0,
    );
    assert.equal(triangles, 35840);
    assert.equal(gltf.nodes.length, 11);
    const base = join(root, 'site/assets/kinetic-garden/cache/native/full');
    const pointer = JSON.parse(await readFile(join(base, 'manifest.json'), 'utf8')) as CachePointer;
    const manifest = JSON.parse(await readFile(join(base, pointer.url), 'utf8')) as CacheManifest;
    assert.equal(manifest.sourceTriangles, triangles);
    assert.equal(manifest.formatVersion, pointer.formatVersion);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
