/**
 * Bevelled shapes, the ones that make a manufactured object read as real at close range: a box
 * with rounded edges and corners, and an outline extruded with rounded rims (a car's side
 * profile, a wing's planform, a bench leg). Both stay inside the size they are given.
 */
import type { MeshPart, Surface, Vec3 } from '../plan/contract.ts';
import { meshPart, weld } from './geometry.ts';
import { loft } from './round.ts';
import { box } from './shapes.ts';
import { merge } from './transform.ts';
import { signedArea, triangulate, type Point2 } from './triangulate.ts';

/** Grid coordinates of one axis: `segments` steps through each rounded band, one flat cell. */
function axisSteps(inner: number, radius: number, segments: number): number[] {
  const band = Array.from({ length: segments }, (_, k) => {
    const angle = (Math.PI / 4) * ((segments - k) / segments);
    return inner + radius * Math.tan(angle);
  });
  const steps = [...band.map((v) => -v), -inner, inner, ...band.reverse()];
  return steps.filter((v, i) => i === 0 || v !== steps[i - 1]);
}

/**
 * A box of full `size`, base at y = 0, its edges and corners rounded by `radius` in `segments`
 * steps. At `radius` = half the smallest side it is a pill; with a zero size, a cube-sphere.
 */
export function roundedBox(surface: Surface, size: Vec3, radius: number, segments = 4): MeshPart {
  if (radius <= 0 || segments < 1) return box(surface, size);
  const r = Math.min(radius, ...size.map((s) => s / 2)),
    inner = size.map((s) => s / 2 - r),
    steps = inner.map((e) => axisSteps(e, r, segments)),
    positions: number[] = [],
    indices: number[] = [];
  const place = (p: number[]) => {
    const c = p.map((v, k) => Math.max(-inner[k], Math.min(inner[k], v))),
      d = p.map((v, k) => v - c[k]),
      length = Math.hypot(...d) || 1;
    positions.push(
      c[0] + (r * d[0]) / length,
      c[1] + (r * d[1]) / length + size[1] / 2,
      c[2] + (r * d[2]) / length,
    );
  };
  for (let a = 0; a < 3; a++)
    for (const side of [-1, 1]) {
      const b = (a + 1) % 3,
        c = (a + 2) % 3,
        first = positions.length / 3,
        [us, vs] = [steps[b], steps[c]];
      for (const v of vs)
        for (const u of us) {
          const p = [0, 0, 0];
          p[a] = side * (inner[a] + r);
          p[b] = u;
          p[c] = v;
          place(p);
        }
      for (let j = 0; j + 1 < vs.length; j++)
        for (let i = 0; i + 1 < us.length; i++) {
          const q = first + j * us.length + i,
            corners = [q, q + 1, q + 1 + us.length, q + us.length];
          if (side < 0) corners.reverse();
          indices.push(corners[0], corners[1], corners[2], corners[0], corners[2], corners[3]);
        }
    }
  return weld(meshPart(surface, positions, indices));
}

/** A closed outline with its corners cut `iterations` times (Chaikin): a smooth curve. */
function chaikin(points: readonly Point2[], iterations: number): Point2[] {
  let out = [...points];
  for (let n = 0; n < iterations; n++)
    out = out.flatMap((p, i) => {
      const q = out[(i + 1) % out.length];
      return [
        [0.75 * p[0] + 0.25 * q[0], 0.75 * p[1] + 0.25 * q[1]] as Point2,
        [0.25 * p[0] + 0.75 * q[0], 0.25 * p[1] + 0.75 * q[1]] as Point2,
      ];
    });
  return out;
}

/** The outline moved outward by `distance` (inward when negative), clockwise in (x, y). */
function offset(points: readonly Point2[], distance: number): Point2[] {
  const normal = (p: Point2, q: Point2): Point2 => {
    const length = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
    return [-(q[1] - p[1]) / length, (q[0] - p[0]) / length];
  };
  return points.map((p, i) => {
    const before = normal(points[(i + points.length - 1) % points.length], p),
      after = normal(p, points[(i + 1) % points.length]),
      mean = [before[0] + after[0], before[1] + after[1]],
      length = Math.hypot(mean[0], mean[1]) || 1,
      miter = distance / Math.max(0.35, (mean[0] * after[0] + mean[1] * after[1]) / length);
    return [p[0] + (mean[0] / length) * miter, p[1] + (mean[1] / length) * miter];
  });
}

/**
 * A simple outline in the XY plane (metres, either winding, corners cut `smooth` times),
 * extruded along Z over `depth` centred on z = 0, every rim rounded by `bevel` in `segments`
 * steps. The solid stays inside the outline and the depth.
 */
export function bevelExtrude(
  surface: Surface,
  outline: readonly Point2[],
  depth: number,
  {
    bevel = 0,
    segments = 4,
    smooth = 0,
  }: { bevel?: number; segments?: number; smooth?: number } = {},
): MeshPart {
  const curve = chaikin(outline, smooth),
    path = signedArea(curve) < 0 ? curve : [...curve].reverse(),
    b = Math.min(bevel, depth / 2),
    steps = b > 0 ? Math.max(1, segments) : 0,
    rings: Vec3[][] = [];
  for (const end of [-1, 1])
    for (let k = 0; k <= steps; k++) {
      const angle = steps ? (Math.PI / 2) * (end < 0 ? k / steps - 1 : k / steps) : 0,
        z = end * (depth / 2 - b) + b * Math.sin(angle);
      rings.push(offset(path, -b + b * Math.cos(angle)).map(([x, y]): Vec3 => [x, y, z]));
    }
  const cap = triangulate(path),
    ends = [rings[0], rings[rings.length - 1]].map((ring, front) => {
      const tris = front
        ? cap.flatMap((_, t) => (t % 3 ? [] : [cap[t], cap[t + 2], cap[t + 1]]))
        : cap;
      return meshPart(surface, ring.flat(), tris);
    });
  return merge([loft(surface, rings), ...ends])[0];
}
