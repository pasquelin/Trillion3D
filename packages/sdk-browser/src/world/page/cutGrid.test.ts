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
  // 768 m on tiles of 2^1 m in 2^16 steps asks 2^-15 m; a page as wide as the primitive holds
  // 2^23 steps, 2^-13 m, where the untiled rule gave 2^-6 (15.6 mm).
  assert.equal(cut.positionExponent, 10 - 23);
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

// #846: a compiled primitive cut again in session keeps its own clusters and takes the grids the
// compiler gives its class (`bits/grid.rs`): blended, the finest its extent and texture span hold;
// otherwise the tiled grid of the scale that places it, or the eighth of its DAG's finest error.
test('a recut takes the compiler grids of its class: finest when blended, tile and DAG error otherwise', async () => {
  const drawn = {
    positions: Float32Array.of(0, 0, 0, 100, 0, 0, 0, 0.001, 0, 50, 50, 0),
    normals: new Float32Array(0),
    uvs: Float32Array.of(0, 0, 0.5, 0, 0, 0.25, 0.1, 0.1),
    colors: null,
    indices: Uint32Array.of(0, 1, 2, 1, 3, 2),
  };
  const recut = (blended: boolean, finestError = 0, scale = 0) =>
    cutDrawnTriangles(drawn, false, blended, { ends: Uint32Array.of(3, 6), finestError, scale });
  const grids = async (cut: ReturnType<typeof recut>) => {
    const { positionExponent, uvExponent, pages } = await cut;
    return {
      positionExponent,
      uvExponent,
      pages: pages.map((page) => [...new Uint32Array(page.index)]),
    };
  };
  const clusters = [
    [0, 1, 2],
    [1, 3, 2],
  ];
  // 100 m in 2^23 steps; the texture span 0.5 in 2^23 steps too, finer than the format's 2^-14.
  assert.deepEqual(await grids(recut(true)), {
    positionExponent: 7 - 23,
    uvExponent: -1 - 23,
    pages: clusters,
  });
  // A metre per unit: tiles of 2^1 m in 2^16 steps; the format's texture grid.
  assert.deepEqual(await grids(recut(false)), {
    positionExponent: 1 - 16,
    uvExponent: -14,
    pages: clusters,
  });
  // A centimetre per unit: the extent's own 2^6 in 2^16 steps, under a tile of 200 units.
  assert.equal((await recut(false, 0, 0.01)).positionExponent, 6 - 16);
  // There, a DAG whose finest error is 2^-10: an eighth of it.
  assert.equal((await recut(false, 2 ** -10, 0.01)).positionExponent, -13);
});
