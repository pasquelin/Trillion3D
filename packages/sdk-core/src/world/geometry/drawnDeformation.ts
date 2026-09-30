import { isSkinIndex, skinStreams } from './skin.ts';
import type { Geometry } from './geometry.ts';
import type { DrawnTriangles } from './drawn.ts';
import { readComponent } from './bounds.ts';

/** Source attributes follow the same vertex permutation as the raster's drawn triangles. */
export type DrawnDeformation = {
  influences?: number;
  joints?: Float32Array;
  weights?: Float32Array;
  targets: { positions: Float32Array; normals: Float32Array }[];
};

/** Whether `g` carries a skin or morph targets: only then does a drawn vertex keep which source
 *  vertex it came from (`DrawnTriangles.sourceVertices`). */
export const deforms = (g: Geometry) =>
  !!g.morphAttributes.position?.length || Object.keys(g.attributes).some(isSkinIndex);

/** Setup-time extraction only: animation uploads palettes and weights, never these vertices. */
export function drawnDeformation(g: Geometry, drawn: DrawnTriangles | null) {
  if (!drawn) return null;
  const count = drawn.positions.length / 3;
  const source = (v: number) => drawn.sourceVertices?.[v] ?? v;
  const skin = skinStreams(g);
  const list = (weight: boolean) => {
    if (!skin.width) return undefined;
    const result = new Float32Array(count * skin.width);
    for (let v = 0; v < count; v++)
      for (let c = 0; c < skin.width; c++)
        result[v * skin.width + c] = skin.read(source(v), c, weight);
    return result;
  };
  const targets = (g.morphAttributes.position ?? []).map((position, target) => {
    const positions = new Float32Array(count * 3),
      normals = new Float32Array(count * 3),
      normal = g.morphAttributes.normal?.[target];
    for (let v = 0; v < count; v++) {
      const vertex = source(v);
      for (let c = 0; c < 3; c++) {
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
    }
    return { positions, normals };
  });
  const joints = list(false),
    weights = list(true);
  if ((joints && weights) || targets.length)
    drawn.deformation = { joints, weights, targets, influences: skin.width };
  return drawn;
}
