import { GeometryBuilder, fromArrays } from './builder.ts';
import { flatGeometry } from './drawnFlat.ts';
import { signedArea, triangulate } from './triangulate.ts';
import type { Shape } from '../math/curves.ts';

type P = [number, number];

/** The outline and holes of a shape, sampled, each a list of plane points. */
function rings(shape: Shape, curveSegments: number) {
  const outline = shape.getPoints(curveSegments).map((p): P => [p.x, p.y]);
  if (signedArea(outline) < 0) outline.reverse();
  const holes = shape.holes.map((hole) => {
    const ring = hole.getPoints(curveSegments).map((p): P => [p.x, p.y]);
    return signedArea(ring) > 0 ? ring.reverse() : ring;
  });
  // Counter-clockwise outline, clockwise holes: the solid always lies to the left of travel.
  return { outline, holes };
}

/**
 * A flat shape in the `xy` plane, facing `+z`, holes left open.
 * @param outline - The flat outline to fill.
 * @param curveSegments - Straight pieces for each curve of the outline.
 */
export function shape(outline: Shape, curveSegments = 12) {
  const { outline: ring, holes } = rings(outline, curveSegments);
  const { points, triangles } = triangulate(ring, holes);
  return fromArrays(
    points.flatMap(([x, y]) => [x, y, 0]),
    points.flatMap(() => [0, 0, 1]),
    points.flatMap(([x, y]) => [x, y]),
    triangles,
  );
}

/** How `geometry.extrude` pushes a flat shape into a solid. */
export interface ExtrudeOptions {
  /** How far the shape is pushed. */
  depth?: number;
  /** How many slices the push is cut into. */
  steps?: number;
  /** Whether the edges are rounded off. */
  bevelEnabled?: boolean;
  /** How deep the rounded edge goes into the solid. */
  bevelThickness?: number;
  /** How far the rounded edge reaches out from the outline. */
  bevelSize?: number;
  /** How many steps the rounded edge is cut into. */
  bevelSegments?: number;
  /** How many straight pieces each curve of the outline becomes. */
  curveSegments?: number;
}

/** Each point of a ring pushed `by` away from the solid, along the bisector of its two edges. */
function offsetRing(ring: P[], by: number): P[] {
  if (by === 0) return ring;
  return ring.map((p, i) => {
    const a = ring[(i + ring.length - 1) % ring.length],
      b = ring[(i + 1) % ring.length];
    const e1 = norm([p[0] - a[0], p[1] - a[1]]),
      e2 = norm([b[0] - p[0], b[1] - p[1]]);
    const n = norm([e1[1] + e2[1], -(e1[0] + e2[0])]);
    const miter = Math.max(0.25, n[0] * e1[1] - n[1] * e1[0]);
    return [p[0] + (n[0] * by) / miter, p[1] + (n[1] * by) / miter];
  });
}
const norm = ([x, y]: P): P => {
  const l = Math.hypot(x, y) || 1;
  return [x / l, y / l];
};

/**
 * A shape swept along `z` over `depth`, its rims rounded by a bevel when enabled: `bevelThickness`
 * deep, `bevelSize` wide, in `bevelSegments` quarter-circle steps. Faces are flat, as a solid cut
 * from a plank is.
 * @param outline - The flat shape to push.
 * @param options - How far and how it is pushed.
 */
export function extrude(outline: Shape, options: ExtrudeOptions = {}) {
  const depth = options.depth ?? 1,
    steps = Math.max(1, options.steps ?? 1),
    bevel = options.bevelEnabled ?? true,
    thickness = bevel ? (options.bevelThickness ?? 0.2) : 0,
    size = bevel ? (options.bevelSize ?? thickness - 0.1) : 0,
    segments = bevel ? Math.max(1, options.bevelSegments ?? 3) : 0;
  const layers: [number, number][] = [];
  for (let s = 0; s <= segments; s++) {
    const a = ((s / Math.max(1, segments)) * Math.PI) / 2;
    if (bevel) layers.push([-thickness * Math.cos(a), size * Math.sin(a)]);
  }
  for (let s = bevel ? 1 : 0; s <= steps; s++) layers.push([(depth * s) / steps, size]);
  for (let s = segments - 1; bevel && s >= 0; s--) {
    const a = ((s / segments) * Math.PI) / 2;
    layers.push([depth + thickness * Math.cos(a), size * Math.sin(a)]);
  }
  const { outline: ring, holes } = rings(outline, options.curveSegments ?? 12);
  const b = new GeometryBuilder();
  const { points, triangles } = triangulate(ring, holes);
  const [front, back] = [layers[0][0], layers[layers.length - 1][0]];
  for (let t = 0; t < triangles.length; t += 3) {
    const [i, j, k] = [triangles[t], triangles[t + 1], triangles[t + 2]];
    const at = (v: number, z: number) =>
      b.vertex([points[v][0], points[v][1], z], [0, 0, 0], points[v]);
    b.triangle(at(i, front), at(k, front), at(j, front));
    b.triangle(at(i, back), at(j, back), at(k, back));
  }
  for (const contour of [ring, ...holes]) {
    const walls = layers.map(([z, grow]) =>
      offsetRing(contour, grow).map(([x, y]) => [x, y, z] as const),
    );
    for (let l = 0; l + 1 < walls.length; l++)
      for (let i = 0; i < contour.length; i++) {
        const n = (i + 1) % contour.length;
        const v = [walls[l][i], walls[l][n], walls[l + 1][n], walls[l + 1][i]].map((p, c) =>
          b.vertex(p, [0, 0, 0], [c === 0 || c === 3 ? 0 : 1, c < 2 ? 0 : 1]),
        );
        b.triangle(v[0], v[1], v[2]);
        b.triangle(v[0], v[2], v[3]);
      }
  }
  return flatGeometry(b);
}
