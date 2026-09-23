/**
 * Harbour steel at real size: 40 ft ISO containers with corrugated walls, and a ship-to-shore
 * gantry crane (box-girder legs spanning 30 m along X, a lattice boom reaching out over +Z).
 */
import type { MeshPart, PropMesh, Surface } from '../plan/contract.ts';
import { cylinder, tube } from './round.ts';
import { box, extrude } from './shapes.ts';
import { roundedBox } from './smooth.ts';
import { SURFACES } from './surfaces.ts';
import { prop, transform } from './transform.ts';
import type { Point2 } from './triangulate.ts';
import { truss } from './truss.ts';

const { craneYellow, darkMetal, glass, steel } = SURFACES;

/** A corrugated wall `length` long along X, `ribs` trapezoid ribs, standing `height` high. */
function corrugated(surface: Surface, length: number, height: number, ribs: number): MeshPart {
  const pitch = length / ribs,
    wave = (k: number, shift: number): Point2[] => {
      const x = -length / 2 + k * pitch;
      return [
        [x + pitch * 0.1, shift],
        [x + pitch * 0.35, shift + 0.04],
        [x + pitch * 0.6, shift + 0.04],
        [x + pitch * 0.85, shift],
      ];
    };
  const outer = Array.from({ length: ribs }, (_, k) => wave(k, 0)).flat(),
    inner = Array.from({ length: ribs }, (_, k) => wave(k, -0.02))
      .flat()
      .reverse();
  return extrude(surface, [...outer, ...inner], height);
}

/** A 40 ft container, 12.19 × 2.59 × 2.44 m, long side along X, doors at +X. */
export function container(surface: Surface, id: string): PropMesh {
  const walls = [-1, 1].map((side) =>
      transform(corrugated(surface, 11.9, 2.4, 60), {
        at: [0, 0.1, side * 1.2],
        yaw: side > 0 ? Math.PI : 0,
      }),
    ),
    ends = [-1, 1].map((side) =>
      transform(box(surface, [0.05, 2.4, 2.3]), { at: [side * 6.05, 0.1, 0] }),
    ),
    frame = [0, 2.49].flatMap((y) =>
      [-1, 1].map((side) =>
        transform(box(darkMetal, [12.19, 0.1, 0.12]), { at: [0, y, side * 1.16] }),
      ),
    ),
    posts = [-1, 1].flatMap((sx) =>
      [-1, 1].map((sz) =>
        transform(roundedBox(darkMetal, [0.16, 2.59, 0.16], 0.02, 1), {
          at: [sx * 6.02, 0, sz * 1.14],
        }),
      ),
    ),
    bars = [-0.9, -0.3, 0.3, 0.9].map((z) =>
      transform(cylinder(steel, 0.025, 2.3, { segments: 8 }), { at: [6.1, 0.15, z] }),
    ),
    roof = transform(box(surface, [12.0, 0.04, 2.3]), { at: [0, 2.5, 0] });
  return prop(id, [...walls, ...ends, ...frame, ...posts, ...bars, roof]);
}

/** A ship-to-shore gantry crane, 52 m high. */
export function gantryCrane(): PropMesh {
  const legs = [-1, 1].flatMap((sx) =>
      [-1, 1].map((sz) =>
        transform(roundedBox(craneYellow, [1.6, 40, 1.6], 0.15, 2), { at: [sx * 15, 0, sz * 8] }),
      ),
    ),
    portal = [-1, 1].flatMap((sz) => [
      transform(roundedBox(craneYellow, [32, 2.6, 1.8], 0.2, 2), { at: [0, 37.5, sz * 8] }),
      transform(roundedBox(craneYellow, [32, 1.4, 1.2], 0.15, 2), { at: [0, 12, sz * 8] }),
    ]),
    boom = [-1, 1].map((sx) =>
      truss(craneYellow, [sx * 5, 41, -30], [sx * 5, 41, 60], {
        width: [2.4, 2.4],
        bays: 22,
        chord: 0.14,
        brace: 0.06,
      }),
    ),
    apex = [-1, 1].flatMap((sx) => [
      truss(craneYellow, [sx * 5, 41, -6], [sx * 3, 56, 0], {
        width: [1.4, 0.8],
        bays: 6,
        chord: 0.1,
        brace: 0.05,
      }),
      truss(craneYellow, [sx * 5, 41, 6], [sx * 3, 56, 0], {
        width: [1.4, 0.8],
        bays: 6,
        chord: 0.1,
        brace: 0.05,
      }),
      tube(
        darkMetal,
        [
          [sx * 3, 56, 0],
          [sx * 5, 42.4, 58],
        ],
        0.08,
        { segments: 6 },
      ),
      tube(
        darkMetal,
        [
          [sx * 3, 56, 0],
          [sx * 5, 42.4, -28],
        ],
        0.08,
        { segments: 6 },
      ),
    ]),
    house = transform(roundedBox(craneYellow, [12, 5, 9], 0.3, 2), { at: [0, 39, -24] }),
    trolley = transform(roundedBox(darkMetal, [7, 1.6, 4], 0.2, 2), { at: [0, 40, 30] }),
    cabin = transform(roundedBox(glass, [3, 2.6, 3.2], 0.25, 3), { at: [0, 36.6, 30] }),
    ropes = [-1, 1].map((sx) =>
      tube(
        darkMetal,
        [
          [sx * 1.5, 40, 30],
          [sx * 1.5, 20, 30],
        ],
        0.03,
        { segments: 5 },
      ),
    ),
    spreader = transform(roundedBox(craneYellow, [12.4, 0.6, 2.4], 0.1, 2), { at: [0, 19.4, 30] });
  return prop('gantry-crane', [
    ...legs,
    ...portal,
    ...boom,
    ...apex,
    house,
    trolley,
    cabin,
    ...ropes,
    spreader,
  ]);
}
