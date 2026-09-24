/**
 * Boats under way: sailboats tacking round loops in the bay, motorboats running wider loops,
 * and a fishing boat shuttling between the island port and the pier. A loop is an ellipse laid
 * along the coast; it shrinks until every point and every leg between them is open water.
 */
import type { Vec3 } from '../../../plan/contract.ts';
import type { ShoreFrame } from './frame.ts';
import type { Layout } from './layout.ts';

/** Water this deep keeps a keel off the bottom, metres. */
const DEPTH = -3;

/** Whether the straight leg a → b stays over open water inside the region. */
function openWater(layout: Layout, a: Vec3, b: Vec3): boolean {
  const { bounds } = layout.map,
    steps = Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2]) / 20);
  for (let i = 0; i <= steps; i++) {
    const x = a[0] + ((b[0] - a[0]) * i) / steps,
      z = a[2] + ((b[2] - a[2]) * i) / steps;
    if (x < bounds.minX || x > bounds.maxX || z < bounds.minZ || z > bounds.maxZ) return false;
    if (layout.map.height(x, z) > DEPTH) return false;
  }
  return true;
}

/** An elliptic loop of `radius` about (x, z), long axis along the coast, shrunk until open. */
function loop(
  layout: Layout,
  f: ShoreFrame,
  x: number,
  z: number,
  radius: number,
): Vec3[] | undefined {
  for (let r = radius; r >= radius / 4; r *= 0.7) {
    const points = Array.from({ length: 16 }, (_, i): Vec3 => {
      const a = (i / 16) * Math.PI * 2,
        along = Math.cos(a) * r,
        out = Math.sin(a) * r * 0.5;
      return [
        x + f.tangent[0] * along + f.normal[0] * out,
        0,
        z + f.tangent[1] * along + f.normal[1] * out,
      ];
    });
    if (points.every((p, i) => openWater(layout, p, points[(i + 1) % points.length])))
      return points;
  }
  return undefined;
}

/** Sail and motor loops off each shore frame, `distance` out to sea. */
export function sailing(layout: Layout, frames: readonly ShoreFrame[]) {
  let index = 0;
  for (const f of frames)
    for (const [model, distance, radius, speed] of [
      ['sailboat', 350, 300, 3],
      ['sailboat', 800, 500, 3.5],
      ['motorboat', 1_200, 700, 9],
    ] as const) {
      const [x, z] = [f.origin[0] + f.normal[0] * distance, f.origin[2] + f.normal[1] * distance],
        points = loop(layout, f, x, z, radius);
      if (points)
        layout.movers.push({
          kind: 'path',
          name: `coast/${model}-${index++}`,
          model,
          points,
          speed,
          loop: true,
        });
    }
}

/** A fishing boat between two moorings, out and back, when open water joins them. */
export function ferry(layout: Layout, from: ShoreFrame, to: ShoreFrame) {
  const at = (f: ShoreFrame): Vec3 => [
      f.origin[0] + f.normal[0] * 250,
      0,
      f.origin[2] + f.normal[1] * 250,
    ],
    a = at(from),
    b = at(to),
    mid: Vec3 = [(a[0] + b[0]) / 2, 0, (a[2] + b[2]) / 2];
  // A straight crossing, or one bent out to sea round a headland.
  for (const via of [undefined, 0.3, 0.6]) {
    const bend: Vec3 | undefined =
      via === undefined
        ? undefined
        : [
            mid[0] + (from.normal[0] + to.normal[0]) * via * Math.hypot(b[0] - a[0], b[2] - a[2]),
            0,
            mid[2] + (from.normal[1] + to.normal[1]) * via * Math.hypot(b[0] - a[0], b[2] - a[2]),
          ];
    const points = bend ? [a, bend, b] : [a, b];
    if (points.every((p, i) => i === 0 || openWater(layout, points[i - 1], p))) {
      layout.movers.push({
        kind: 'path',
        name: 'coast/fishing-run',
        model: 'coast-fishing-boat-blue',
        points: [...points, ...points.slice(1, -1).reverse()],
        speed: 5,
        loop: true,
      });
      return;
    }
  }
}
