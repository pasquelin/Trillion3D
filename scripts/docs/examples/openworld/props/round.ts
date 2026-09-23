/**
 * Round shapes, all swept rings: a lathe turns a profile about +Y (cylinder, cone, sphere,
 * trunks, domes, towers), a tube sweeps a circle along a polyline (cables, pipes, rails).
 * Sides are smooth, caps flat. Lathes stand on y = 0 like the flat shapes; `sphere` is the one
 * shape centred on the origin.
 */
import type { MeshPart, Surface, Vec3 } from '../plan/contract.ts';
import { meshPart, weld, type Shading } from './geometry.ts';
import { merge } from './transform.ts';
import { cross, dot, sub, unit } from './vector.ts';

/** A profile point: `[radius, y]`. A radius of 0 closes the shape to a single pole vertex. */
export type ProfilePoint = readonly [radius: number, y: number];

type RoundOptions = { segments?: number; caps?: boolean; shading?: Shading };

/**
 * Side triangles between consecutive rings of `segments` vertices each (or 1, a pole). Ring i
 * starts at `starts[i]`; ring vertex j sits at angle 2πj/segments in the ring's own frame.
 */
function stitch(starts: readonly number[], sizes: readonly number[], segments: number) {
  const indices: number[] = [];
  const at = (i: number, j: number) => starts[i] + (sizes[i] === 1 ? 0 : j % segments);
  for (let i = 0; i + 1 < starts.length; i++)
    for (let j = 0; j < segments; j++) {
      const a = at(i, j),
        b = at(i + 1, j),
        c = at(i, j + 1),
        d = at(i + 1, j + 1);
      if (a !== c) indices.push(a, b, c);
      if (b !== d) indices.push(c, b, d);
    }
  return indices;
}

/** A flat cap over one ring, fanned from its first vertex, facing `up` or down. */
function capOf(ring: readonly Vec3[], up: boolean): [number[], number[]] {
  const indices: number[] = [];
  for (let j = 1; j + 1 < ring.length; j++) indices.push(0, up ? j + 1 : j, up ? j : j + 1);
  return [ring.flat(), indices];
}

/**
 * A loft: closed rings of points (all of one length, or a single pole point) stitched in order
 * into one part, with optional flat caps facing out of both ends. A ring turns the way a lathe's
 * does — from +X toward +Z when the rings advance along +Y (a left-handed turn about the
 * travel) — so the sides face outward. Hulls, blades, fuselages, trunks.
 */
export function loft(
  surface: Surface,
  rings: readonly (readonly Vec3[])[],
  { caps = false, shading = 'smooth' }: { caps?: boolean; shading?: Shading } = {},
): MeshPart {
  const segments = Math.max(...rings.map((ring) => ring.length)),
    positions = rings.flat(2),
    starts: number[] = [],
    sizes = rings.map((ring) => ring.length);
  sizes.reduce((offset, size) => (starts.push(offset), offset + size), 0);
  const parts = [meshPart(surface, positions, stitch(starts, sizes, segments), shading)];
  if (caps)
    for (const end of [0, 1] as const) {
      const ring = rings[end ? rings.length - 1 : 0];
      if (ring.length > 2) parts.push(meshPart(surface, ...capOf(ring, end === 1)));
    }
  return merge(parts)[0];
}

/** A profile turned about +Y; profile points bottom to top so the sides face outward. */
export function lathe(
  surface: Surface,
  profile: readonly ProfilePoint[],
  { segments = 12, caps = true, shading = 'smooth' }: RoundOptions = {},
): MeshPart {
  const rings = profile.map(([r, y]): Vec3[] =>
    r <= 1e-9
      ? [[0, y, 0]]
      : Array.from({ length: segments }, (_, j): Vec3 => {
          const a = (2 * Math.PI * j) / segments;
          return [r * Math.cos(a), y, r * Math.sin(a)];
        }),
  );
  return loft(surface, rings, { caps, shading });
}

/** A cylinder of `radius` and `height`; `top` narrows it into a truncated cone. */
export const cylinder = (
  surface: Surface,
  radius: number,
  height: number,
  { top = radius, ...options }: RoundOptions & { top?: number } = {},
) =>
  lathe(
    surface,
    [
      [radius, 0],
      [top, height],
    ],
    options,
  );

/** A cone of base `radius`, apex at `height`. */
export const cone = (surface: Surface, radius: number, height: number, options?: RoundOptions) =>
  cylinder(surface, radius, height, { ...options, top: 0 });

/** A sphere centred on the origin, `rings` bands from pole to pole. */
export function sphere(
  surface: Surface,
  radius: number,
  { segments = 12, rings = 8, shading = 'smooth' }: RoundOptions & { rings?: number } = {},
): MeshPart {
  const profile = Array.from({ length: rings + 1 }, (_, i): ProfilePoint => {
    const angle = Math.PI * (i / rings - 0.5);
    return [i === 0 || i === rings ? 0 : radius * Math.cos(angle), radius * Math.sin(angle)];
  });
  return lathe(surface, profile, { segments, shading });
}

/**
 * A tube of `radius` (one value, or one per point) along a polyline in the part's own
 * coordinates. Frames are parallel-transported, so the tube never twists.
 */
export function tube(
  surface: Surface,
  points: readonly Vec3[],
  radius: number | readonly number[],
  { segments = 6, caps = false, shading = 'smooth' }: RoundOptions = {},
): MeshPart {
  if (points.length < 2) throw new Error('tube: a polyline needs two points');
  const tangents = points.map((_, i) =>
    unit(sub(points[Math.min(i + 1, points.length - 1)], points[Math.max(i - 1, 0)])),
  );
  const seed: Vec3 = Math.abs(tangents[0][1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  let normal = unit(cross(cross(tangents[0], seed), tangents[0]));
  const rings = points.map((p, i): Vec3[] => {
    const t = tangents[i];
    const along = dot(normal, t);
    normal = unit([normal[0] - t[0] * along, normal[1] - t[1] * along, normal[2] - t[2] * along]);
    const binormal = cross(normal, t),
      r = typeof radius === 'number' ? radius : radius[i];
    return Array.from({ length: segments }, (_, j): Vec3 => {
      const a = (2 * Math.PI * j) / segments,
        [c, s] = [Math.cos(a) * r, Math.sin(a) * r];
      return [
        p[0] + c * normal[0] + s * binormal[0],
        p[1] + c * normal[1] + s * binormal[1],
        p[2] + c * normal[2] + s * binormal[2],
      ];
    });
  });
  return loft(surface, rings, { caps, shading });
}

/**
 * A ring torus about +Y, centred on the origin: `radius` to the tube's centre line, `thickness`
 * the tube's radius, `segments` around the ring, `sides` around the tube. A tyre, a rail loop.
 */
export function torus(
  surface: Surface,
  radius: number,
  thickness: number,
  { segments = 32, sides = 12 }: { segments?: number; sides?: number } = {},
): MeshPart {
  const profile = Array.from({ length: sides + 1 }, (_, i): ProfilePoint => {
    const a = (2 * Math.PI * i) / sides;
    return [radius + thickness * Math.cos(a), thickness * Math.sin(a)];
  });
  return weld(lathe(surface, profile, { segments, caps: false }));
}
