// A material moved into or out of blended in the session (#846): the compiler cuts a blended
// primitive on finer grids (#875), so WebGL2 cuts the primitive's pages again from its source
// vertices on the grids of its new class, and draws its own pages again once back.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as G from '../../host/graph/graph.fixture.ts';
import { encodeGeometryPage } from '../../../../page-codec/geometryPage.ts';
import { decodeGeometryPage } from '../../page/decode/geometryPage.ts';
import { prepareSdkWasm } from '../../page/decode/geometryPageWasm.ts';
import type { AlphaMode } from '../../../../sdk-core/src/contracts/material.ts';
import { triangleBackend } from './triangle.fixture.ts';

// The grids are the compiler's rules, run in the SDK module: Node is handed its bytes.
await prepareSdkWasm(readFileSync(join(import.meta.dirname, '../../page/decode/pageCodec.wasm')));

/** The triangle's source vertices, off both grids: each class rounds them its own way. */
const SOURCE = [-0.3, -0.3, 0, 0.3, -0.3, 0, 0, 0.3, 0];

/** The triangle opened on WebGL2 from a page cut before its source moved to `SOURCE`. */
async function opened() {
  const triangle = triangleBackend();
  await triangle.backend.prepare();
  (triangle.geometry.getAttribute('position')!.array as Float32Array).set(SOURCE);
  return triangle;
}

/** The positions the display graph draws the page with. */
function drawnPositions({ backend, camera }: Awaited<ReturnType<typeof opened>>) {
  backend.render(camera);
  const [mesh] = (backend.scene as unknown as G.Group).children.filter((c) => 'geometry' in c);
  return [...(mesh as G.Mesh).geometry.getAttribute('position')!.array];
}

/** The material written to `to`, and the engine told. */
function move(triangle: Awaited<ReturnType<typeof opened>>, from: AlphaMode, to: AlphaMode) {
  triangle.material.transparent = to === 'blend';
  triangle.backend.refreshMaterials!(true, { surfaces: [triangle.material], from, to });
}

/** The page positions of `SOURCE` cut on a position grid of 2^`exponent`. */
const cutOn = (exponent: number) =>
  decodeGeometryPage(
    encodeGeometryPage(
      Uint32Array.of(0, 1, 2),
      {
        POSITION: { itemSize: 3, array: Float32Array.from(SOURCE) },
      },
      exponent,
    ).data,
  ).attributes.position;

test('WebGL2 draws a primitive turned blended on the blended grid, and its own page once back', async () => {
  const triangle = await opened();
  const { backend, geometry, material, encoded } = triangle;
  try {
    const own = [...decodeGeometryPage(encoded.data).attributes.position];
    assert.deepEqual(drawnPositions(triangle), own);
    move(triangle, 'opaque', 'blend');
    await backend.flush!();
    // A 0.6-wide primitive, blended: 2^23 steps of it, where the opaque grid is 2^-16.
    assert.deepEqual(drawnPositions(triangle), [...cutOn(-23)]);
    assert.notDeepEqual([...cutOn(-23)], [...cutOn(-16)]);
    move(triangle, 'blend', 'opaque');
    await backend.flush!();
    assert.deepEqual(drawnPositions(triangle), own, 'compiled opaque: the page it reads');
  } finally {
    backend.dispose();
    geometry.dispose();
    material.dispose();
  }
});

test('WebGL2 refuses by name a move whose pages carry a second texture coordinate', async () => {
  const triangle = await opened();
  const { backend, geometry, material, paged } = triangle;
  try {
    paged.metadata.primitives[0].pages[0].geometry!.flags |= 4;
    const alpha = { surfaces: [material], from: 'opaque', to: 'blend' } as const;
    assert.match(backend.materialClassRefusal!(alpha) ?? '', /second texture coordinate/);
    const back = { ...alpha, surfaces: [new G.GraphSurface('basic')] };
    assert.equal(backend.materialClassRefusal!(back), undefined, 'a surface nothing wears');
  } finally {
    backend.dispose();
    geometry.dispose();
    material.dispose();
  }
});
