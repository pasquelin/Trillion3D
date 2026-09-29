import { PROXY_TRIANGLE_FLOATS } from '../../contracts/proxy.ts';

// Apart from the refit: occupancy reads it from the core index, and the refit's rounding scratch
// must not ride into every bundle that imports the index.
/** Canonical bounds of each proxy triangle, six per triangle: what a still pose covers. */
export function proxyTriangleBoxes(triangles: Float32Array) {
  const boxes = new Float64Array((triangles.length / PROXY_TRIANGLE_FLOATS) * 6);
  for (let t = 0; t < boxes.length / 6; t++)
    for (let a = 0; a < 3; a++) {
      const base = t * PROXY_TRIANGLE_FLOATS + a;
      const x = triangles[base],
        y = triangles[base + 3],
        z = triangles[base + 6];
      boxes[t * 6 + a] = Math.min(x, y, z);
      boxes[t * 6 + a + 3] = Math.max(x, y, z);
    }
  return boxes;
}
