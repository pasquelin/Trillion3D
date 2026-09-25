import test from 'node:test';
import assert from 'node:assert/strict';
import { geometry } from './index.ts';
import { drawnTriangles } from './drawn.ts';
import { BufferAttribute } from '../buffer/index.ts';

/** The corners of a drawn quad, four per segment: `a` twice, then `b` twice. */
function corners(drawn: NonNullable<ReturnType<typeof drawnTriangles>>, quad: number) {
  const at = (v: number, from: Float32Array) => Array.from(from.subarray(v * 3, v * 3 + 3));
  return [0, 1, 2, 3].map((k) => ({
    p: at(quad * 4 + k, drawn.positions),
    n: at(quad * 4 + k, drawn.normals),
  }));
}

// #348: a segment is two triangles whose corners all sit on its endpoints, the direction in the
// normal signed by side — the rasters widen it on screen. It was a closed prism of twelve
// triangles, as thick as a share of the geometry's diagonal.
test('a line segment draws as a quad on its endpoints, its direction signed by side', () => {
  const box = geometry.box(1, 1, 1);
  const drawn = drawnTriangles(geometry.edges(box), 'lineSegments')!;
  assert.equal(drawn.lines, true);
  assert.equal(drawn.indices.length, 12 * 6, 'two triangles for each of the 12 edges');
  assert.equal(drawn.positions.length, 12 * 4 * 3, 'four corners per edge');
  assert.equal(drawn.uvs, null);
  for (let quad = 0; quad < 12; quad++) {
    const [a0, a1, b0, b1] = corners(drawn, quad);
    assert.deepEqual(a0.p, a1.p, 'both first corners on the first endpoint');
    assert.deepEqual(b0.p, b1.p, 'both last corners on the last endpoint');
    const d = b0.p.map((x, i) => x - a0.p[i]);
    const length = Math.hypot(...d);
    assert.equal(length, 1, 'a unit box edge');
    for (const [corner, side] of [
      [a0, 1],
      [a1, -1],
      [b0, 1],
      [b1, -1],
    ] as const)
      corner.n.forEach((x, i) => assert.equal(x, (side * d[i]) / length));
  }
  // Every triangle has two corners on one endpoint and one on the other, sides mixed.
  for (let t = 0; t < drawn.indices.length; t += 3) {
    const quad = Math.floor(drawn.indices[t] / 4);
    const local = [0, 1, 2].map((k) => drawn.indices[t + k] - quad * 4);
    assert.ok(local.some((v) => v < 2) && local.some((v) => v >= 2));
  }
});

test('a strip, a loop and a wireframe read their segments into quads; a zero segment draws none', () => {
  const path = geometry.createBuffer({
    position: new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 2, 0]), 3),
  });
  const strip = drawnTriangles(path, 'lineStrip')!;
  assert.equal(strip.indices.length / 6, 2, 'the zero-length middle segment is skipped');
  assert.equal(drawnTriangles(path, 'lineLoop')!.indices.length / 6, 3);
  const wire = drawnTriangles(geometry.box(1, 1, 1), 'triangles', { wireframe: true })!;
  assert.equal(wire.lines, true);
  assert.equal(wire.indices.length / 6, 18, 'twelve box edges and six face diagonals');
  const faces = drawnTriangles(geometry.box(1, 1, 1), 'triangles')!;
  assert.equal(faces.lines, undefined, 'faces stay faces');
});
