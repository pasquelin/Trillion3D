import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { prepareSdkWasm } from '../../page/decode/geometryPageWasm.ts';
import { decodeGeometryPage } from '../../page/decode/geometryPage.ts';
import { cutDrawnTriangles } from './runtimeCut.ts';

// #959: the run-time cut quantizes on the compiler's tiled grid (`bits/grid.rs`), run in the SDK
// module. Node cannot fetch the module by its URL: the test hands it the bytes.
await prepareSdkWasm(readFileSync(join(import.meta.dirname, '../../page/decode/pageCodec.wasm')));

const SOURCE = join(
  import.meta.dirname,
  '../../../../../site/assets/examples/terrain-tiles/source',
);

/** The nine tiles of the terrain-tiles example, placed by their nodes: one 768 m primitive. */
function terrain() {
  const gltf = JSON.parse(readFileSync(join(SOURCE, 'terrain-tiles.gltf'), 'utf8'));
  const bin = readFileSync(join(SOURCE, 'terrain-tiles.bin'));
  const read = <T>(accessor: number, Kind: new (b: ArrayBuffer, o: number, n: number) => T) => {
    const { bufferView, count, type } = gltf.accessors[accessor];
    const width = { SCALAR: 1, VEC2: 2, VEC3: 3 }[type as 'SCALAR' | 'VEC2' | 'VEC3'];
    const view = gltf.bufferViews[bufferView];
    return new Kind(bin.buffer, bin.byteOffset + view.byteOffset, count * width);
  };
  const positions: number[] = [],
    normals: number[] = [],
    uvs: number[] = [],
    indices: number[] = [];
  for (const node of gltf.nodes) {
    const { attributes, indices: index } = gltf.meshes[node.mesh].primitives[0];
    const base = positions.length / 3;
    read(attributes.POSITION, Float32Array).forEach((v, i) =>
      positions.push(v + node.translation[i % 3]),
    );
    normals.push(...read(attributes.NORMAL, Float32Array));
    uvs.push(...read(attributes.TEXCOORD_0, Float32Array));
    for (const corner of read(index, Uint32Array)) indices.push(base + corner);
  }
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    colors: null,
    indices: new Uint32Array(indices),
  };
}

test('a kilometre-wide primitive cut at run time sits on the tiled grid, within half a step', async () => {
  const drawn = terrain();
  const cut = await cutDrawnTriangles(drawn, false, false);
  // 768 m on tiles of 2^5 m in 2^16 steps: 2^-11 m, where the untiled rule gave 2^-6 (15.6 mm).
  assert.equal(cut.positionExponent, 5 - 16);
  const half = 2 ** cut.positionExponent / 2;
  let worst = 0;
  for (const page of cut.pages) {
    const decoded = decodeGeometryPage(new Uint8Array(page.geometry));
    const corners = new Uint32Array(page.index);
    decoded.indices.forEach((local, k) => {
      for (let c = 0; c < 3; c++) {
        const source = drawn.positions[corners[k] * 3 + c];
        worst = Math.max(worst, Math.abs(decoded.attributes.position[local * 3 + c] - source));
      }
    });
  }
  assert.ok(worst <= half, `${worst} against ${half}`);
  assert.ok(cut.maxPositionError <= half * Math.sqrt(3));
});
