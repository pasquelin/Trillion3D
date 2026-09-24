/**
 * Small construction helpers the airport's props share: a member between two points (steel
 * beams, mullions, truss bars), a wheel on its axle, a run of repeated parts, a flat paint quad.
 * Generic; nothing here knows about airports.
 */
import type { MeshPart, Surface, Vec3 } from '../../plan/contract.ts';
import { box, cylinder, plane, quads, transform, tube } from '../../props/index.ts';

/**
 * A square member from `a` to `b`, `size` = [width, depth] across it. The box's +Y is turned
 * onto the segment: pitch tilts it off vertical, yaw points the tilt.
 */
export function member(surface: Surface, a: Vec3, b: Vec3, [w, d]: readonly [number, number]) {
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    dz = b[2] - a[2],
    length = Math.hypot(dx, dy, dz),
    flat = Math.hypot(dx, dz);
  return transform(box(surface, [w, length, d]), {
    at: a,
    yaw: flat > 1e-9 ? Math.atan2(dx, dz) : 0,
    pitch: Math.atan2(flat, dy),
  });
}

/** A wheel of `radius` and `width` whose axle runs along X, centred at `at`. */
export const wheel = (surface: Surface, at: Vec3, radius: number, width: number, segments = 12) =>
  transform(cylinder(surface, radius, width, { segments, caps: true }), {
    at: [at[0] - width / 2, at[1], at[2]],
    roll: -Math.PI / 2,
  });

/** `count` copies of a part along `step`, the first at `from`. */
export function repeat(part: MeshPart, count: number, from: Vec3, step: Vec3): MeshPart[] {
  return Array.from({ length: count }, (_, i) =>
    transform(part, {
      at: [from[0] + step[0] * i, from[1] + step[1] * i, from[2] + step[2] * i],
    }),
  );
}

/** A painted rectangle `width` (x) × `length` (z) centred at (x, z), a hair above y = 0. */
export const stripe = (surface: Surface, x: number, z: number, width: number, length: number) =>
  transform(plane(surface, width, length), { at: [x, 0, z] });

/** Points of a circular arc across X from −half to +half, rising `rise` at the crown, at y = 0. */
export function arcPoints(half: number, rise: number, segments: number): [number, number][] {
  // Radius of the circle through (±half, 0) and (0, rise).
  const radius = (half * half + rise * rise) / (2 * rise),
    spread = Math.asin(half / radius);
  return Array.from({ length: segments + 1 }, (_, i) => {
    const a = -spread + (2 * spread * i) / segments;
    return [radius * Math.sin(a), rise - radius + radius * Math.cos(a)];
  });
}

/**
 * A barrel vault: the arc across X swept along Z from −length/2 to +length/2, raised by `y`,
 * facing up and out; `under` adds the soffit facing down.
 */
export function vault(
  surface: Surface,
  [half, rise, length, y]: readonly [number, number, number, number],
  segments: number,
  under?: Surface,
): MeshPart[] {
  const arc = arcPoints(half, rise, segments),
    z = length / 2;
  const faces = arc.slice(0, -1).map(([x0, y0], i): Vec3[] => {
    const [x1, y1] = arc[i + 1];
    return [
      [x0, y + y0, z],
      [x1, y + y1, z],
      [x1, y + y1, -z],
      [x0, y + y0, -z],
    ];
  });
  const parts = [quads(surface, faces)];
  if (under)
    parts.push(
      quads(
        under,
        faces.map((face) => [...face].reverse()),
      ),
    );
  return parts;
}

/** The flat end of a vault at z: a fan under the arc, facing ±Z. */
export function gable(surface: Surface, [half, rise, z, y]: readonly number[], segments: number) {
  const arc = arcPoints(half, rise, segments);
  return quads(
    surface,
    arc.slice(0, -1).map(([x0, y0], i): Vec3[] => {
      const [x1, y1] = arc[i + 1];
      // A springing point sits on the base line: that corner closes to a triangle.
      const face: Vec3[] = [
        [x0, y, z],
        [x1, y, z],
        ...(y1 > 1e-6 ? [[x1, y + y1, z] as Vec3] : []),
        ...(y0 > 1e-6 ? [[x0, y + y0, z] as Vec3] : []),
      ];
      return z > 0 ? face : face.reverse();
    }),
  );
}

/**
 * A lattice arch across X at depth z: an outer and an inner chord `chord` apart and a web
 * zigzagging between them, springing from height `y`.
 */
export function latticeArch(
  surface: Surface,
  {
    half,
    rise,
    y,
    z,
    chord,
    segments,
  }: Record<'half' | 'rise' | 'y' | 'z' | 'chord' | 'segments', number>,
): MeshPart[] {
  const outer = arcPoints(half, rise, segments),
    inner = arcPoints(half - chord * 0.75, rise - chord, segments),
    at = ([x, h]: [number, number]): Vec3 => [x, y + h, z],
    bar = chord / 16;
  return [
    tube(surface, outer.map(at), bar * 1.8, { segments: 8 }),
    tube(surface, inner.map(at), bar * 1.5, { segments: 8 }),
    ...outer.slice(0, -1).map((p, i) => member(surface, at(p), at(inner[i + 1]), [bar, bar])),
    ...inner.slice(0, -1).map((p, i) => member(surface, at(p), at(outer[i + 1]), [bar, bar])),
  ];
}
