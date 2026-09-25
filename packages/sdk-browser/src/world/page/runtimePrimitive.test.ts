import test from 'node:test';
import assert from 'node:assert/strict';
import { geometry } from '../../../../sdk-core/src/world/geometry/index.ts';
import { drawnTriangles } from '../../../../sdk-core/src/world/geometry/drawn.ts';
import { LINE_DEPTH_LAYER } from '../../../../sdk-core/src/lod/depthLayer.ts';
import { cutRuntimePrimitive } from './runtimePrimitive.ts';
import { cutDrawnTriangles, packDrawn } from './runtimeCut.ts';
import { decodeGeometryPage } from '../../page/decode/geometryPage.ts';
import { BufferAttribute } from '../../../../sdk-core/src/world/buffer/attribute.ts';

/** The depth layer of every page the world cuts from `drawn`. */
async function layers(drawn: NonNullable<ReturnType<typeof drawnTriangles>>) {
  const { primitive, urls } = await cutRuntimePrimitive(packDrawn(drawn), !!drawn.lines);
  urls.forEach((url) => URL.revokeObjectURL(url));
  return primitive.pages.map((page) => page.depthLayer ?? 0);
}

// #348: line quads lie in the faces they outline; their pages draw one coplanar layer above them,
// on the same bias every path already applies. Faces keep the untouched layer 0.
test('the pages of line quads draw on the line layer, faces on layer 0', async () => {
  const box = geometry.box(1, 1, 1);
  const lines = await layers(drawnTriangles(geometry.edges(box), 'lineSegments')!);
  assert.ok(lines.length > 0);
  for (const layer of lines) assert.equal(layer, LINE_DEPTH_LAYER);
  for (const layer of await layers(drawnTriangles(box, 'triangles')!)) assert.equal(layer, 0);
});

// #359: a dashed line's distance along the line survives the cut: its pages carry it as their
// first texture coordinate, which every raster reads; a solid line's pages carry none.
test('the pages of a dashed line carry its distance along the line', async () => {
  const points = Array.from({ length: 9 }, (_, k) => [k * 0.5, 0, 0]).flat();
  const path = geometry.createBuffer({
    position: new BufferAttribute(new Float32Array(points), 3),
  });
  const read = async (dashed: boolean) => {
    const cut = await cutDrawnTriangles(drawnTriangles(path, 'lineStrip', { dashed })!);
    return cut.pages.map((page) => decodeGeometryPage(new Uint8Array(page.geometry)));
  };
  const [dashed] = await read(true);
  const along = [...new Set(Array.from(dashed.attributes.uv).filter((_, i) => i % 2 === 0))];
  assert.deepEqual(
    along.sort((a, b) => a - b),
    Array.from({ length: 9 }, (_, k) => k * 0.5),
  );
  for (const page of await read(false)) assert.equal(page.attributes.uv, undefined);
});
