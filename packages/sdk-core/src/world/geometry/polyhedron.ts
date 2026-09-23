import { GeometryBuilder, normalize } from './builder.ts';
import { flatGeometry } from './drawn.ts';

type V3 = [number, number, number];

/**
 * A solid of the given faces, each split into `(detail + 1)²` triangles whose corners are pushed
 * onto the sphere of `radius`. At detail 0 the faces stay flat; above it, the surface is the
 * sphere's and shades smooth. Texture coordinates wrap the sphere by longitude and latitude.
 * @param vertices - The corner positions, three numbers each.
 * @param indices - Which corners make each face, three per face.
 * @param radius - Distance of every corner from the centre.
 * @param detail - How many times each face is split to round it.
 */
export function polyhedron(vertices: number[], indices: number[], radius = 1, detail = 0) {
  const b = new GeometryBuilder();
  const corner = (i: number): V3 => [vertices[i * 3], vertices[i * 3 + 1], vertices[i * 3 + 2]];
  const cuts = Math.max(0, Math.floor(detail)) + 1;
  const put = (p: V3) => {
    const n = normalize(p[0], p[1], p[2]);
    const u = Math.atan2(n[2], -n[0]) / (2 * Math.PI) + 0.5,
      v = Math.atan2(n[1], Math.hypot(n[0], n[2])) / Math.PI + 0.5;
    return b.vertex([n[0] * radius, n[1] * radius, n[2] * radius], n, [u, v]);
  };
  for (let f = 0; f + 2 < indices.length; f += 3) {
    const [a, c, d] = [corner(indices[f]), corner(indices[f + 1]), corner(indices[f + 2])];
    const at = (i: number, j: number): V3 =>
      [0, 1, 2].map((k) => a[k] + ((c[k] - a[k]) * i) / cuts + ((d[k] - a[k]) * j) / cuts) as V3;
    for (let i = 0; i < cuts; i++)
      for (let j = 0; i + j < cuts; j++) {
        b.triangle(put(at(i, j)), put(at(i + 1, j)), put(at(i, j + 1)));
        if (i + j + 1 < cuts)
          b.triangle(put(at(i + 1, j)), put(at(i + 1, j + 1)), put(at(i, j + 1)));
      }
  }
  if (detail > 0) return b.build();
  return flatGeometry(b);
}
