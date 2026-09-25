import test from 'node:test';
import assert from 'node:assert/strict';
import { geometry } from '../../../../sdk-core/src/world/geometry/index.ts';
import { drawnTriangles } from '../../../../sdk-core/src/world/geometry/drawn.ts';
import { LINE_DEPTH_LAYER } from '../../../../sdk-core/src/lod/depthLayer.ts';
import { cutRuntimePrimitive } from './runtimePrimitive.ts';
import { packDrawn } from './runtimeCut.ts';

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
