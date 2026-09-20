import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeObservatory } from './docs/observatory/write.mjs';

const directory = new URL('../docs/assets/gallery/signature-architecture/', import.meta.url);

test('the original observatory reproduces its source and retains distinct materials and reduced DAG levels', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'wg-observatory-'));
  try {
    const gltf = await writeObservatory(temporary);
    for (const name of ['geometry.gltf', 'geometry.bin'])
      assert.deepEqual(
        await readFile(join(temporary, name)),
        await readFile(new URL(`source/${name}`, directory)),
      );
    const bytes = await readFile(join(temporary, 'geometry.bin'));
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let triangles = 0;
    const materialIds = new Set();
    for (const primitive of gltf.meshes[0].primitives) {
      materialIds.add(primitive.material);
      const positions = gltf.accessors[primitive.attributes.POSITION];
      const normals = gltf.accessors[primitive.attributes.NORMAL];
      const indices = gltf.accessors[primitive.indices];
      const indexOffset = gltf.bufferViews[indices.bufferView].byteOffset;
      assert.equal(normals.count, positions.count);
      triangles += indices.count / 3;
      for (let i = 0; i < indices.count; i++)
        assert.ok(
          view.getUint32(indexOffset + i * 4, true) < positions.count,
          'source index is in range',
        );
      for (const accessor of [positions, normals]) {
        const offset = gltf.bufferViews[accessor.bufferView].byteOffset;
        for (let i = 0; i < accessor.count * 3; i++)
          assert.ok(
            Number.isFinite(view.getFloat32(offset + i * 4, true)),
            'source attributes are finite',
          );
      }
    }
    assert.equal(triangles, 91352);
    assert.equal(materialIds.size, 6);
    assert.equal(
      new Set(gltf.materials.map((m) => m.pbrMetallicRoughness.baseColorFactor.join())).size,
      6,
    );
    const base = new URL('cache/native/full/', directory);
    const pointer = JSON.parse(await readFile(new URL('manifest.json', base), 'utf8'));
    const manifest = JSON.parse(await readFile(new URL(pointer.url, base), 'utf8'));
    assert.equal(manifest.sourceTriangles, triangles);
    assert.equal(manifest.simplification, true);
    assert.equal(manifest.primitives.length, materialIds.size);
    const curved = manifest.primitives.filter((primitive) => primitive.dag.levels.length > 1);
    assert.equal(curved.length, 4);
    for (const primitive of curved) {
      const levels = primitive.dag.levels;
      assert.ok(
        levels.at(-1).triangles < levels[0].triangles / 2,
        'curved surfaces really simplify',
      );
      assert.ok(levels.at(-1).errorMax > 0, 'LOD thresholds have a nonzero geometric witness');
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
