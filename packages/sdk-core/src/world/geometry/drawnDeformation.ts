import type { Geometry } from './geometry.ts';
import type { DrawnTriangles } from './drawn.ts';
import { readComponent } from './bounds.ts';

/** Source attributes follow the same vertex permutation as the raster's drawn triangles. */
export type DrawnDeformation = {
  joints?: Float32Array;
  weights?: Float32Array;
  targets: { positions: Float32Array; normals: Float32Array }[];
};

/** Setup-time extraction only: animation uploads palettes and weights, never these vertices. */
export function drawnDeformation(g: Geometry, drawn: DrawnTriangles | null) {
  if (!drawn) return null;
  const count = drawn.positions.length / 3;
  const source = (v: number) => drawn.sourceVertices?.[v] ?? v;
  const list = (name: string) => {
    const attribute = g.attributes[name];
    if (!attribute) return undefined;
    const result = new Float32Array(count * 4);
    for (let v = 0; v < count; v++)
      for (let c = 0; c < 4; c++) result[v * 4 + c] = readComponent(g, attribute, source(v), c);
    return result;
  };
  const targets = (g.morphAttributes.position ?? []).map((position, target) => {
    const positions = new Float32Array(count * 3),
      normals = new Float32Array(count * 3);
    for (let v = 0; v < count; v++)
      for (let c = 0; c < 3; c++) {
        const vertex = source(v),
          normal = g.morphAttributes.normal?.[target];
        positions[v * 3 + c] =
          readComponent(g, position, vertex, c) -
          (g.morphTargetsRelative ? 0 : readComponent(g, g.attributes.position, vertex, c));
        if (normal)
          normals[v * 3 + c] =
            readComponent(g, normal, vertex, c) -
            (g.morphTargetsRelative || !g.attributes.normal
              ? 0
              : readComponent(g, g.attributes.normal, vertex, c));
      }
    return { positions, normals };
  });
  const joints = list('skinIndex'),
    weights = list('skinWeight');
  if ((joints && weights) || targets.length) drawn.deformation = { joints, weights, targets };
  return drawn;
}
