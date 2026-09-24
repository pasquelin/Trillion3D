/**
 * The control tower: a two-storey base block, a fluted concrete shaft with a lit stair slot,
 * the cab flaring out at the top — glass leaning outward on a ring of mullions, a gallery with
 * railings, a deep roof with antennas — and the rotating beacon's housing on its mast. Also the
 * surveillance radar: a lattice tower whose antenna turns on its own node.
 */
import type { MeshPart, PropMesh, Vec3 } from '../../plan/contract.ts';
import {
  box,
  cone,
  cylinder,
  extrude,
  lathe,
  prop,
  SURFACES,
  transform,
  tube,
} from '../../props/index.ts';
import { AIRPORT, LIGHTS } from './palette.ts';
import { member } from './parts.ts';

export const TOWER = {
  shaft: 44,
  cab: 6,
  radius: 5,
  plinth: 2,
  base: [24, 8, 16] as Vec3,
} as const;
/** Heights the layout reads: the cab's floor (a viewpoint) and the beacon on the mast. */
export const TOWER_CAB_FLOOR = TOWER.shaft + 1.2;
export const TOWER_BEACON: Vec3 = [0, TOWER.shaft + TOWER.cab + 7.5, 0];
const RING = 64;

/** A star outline: `n` flutes between radii `r` and `r - depth`. */
const flutes = (n: number, r: number, depth: number) =>
  Array.from({ length: 2 * n }, (_, i): [number, number] => {
    const a = (Math.PI * i) / n,
      radius = i % 2 ? r - depth : r;
    return [radius * Math.cos(a), radius * Math.sin(a)];
  });

function cab(): MeshPart[] {
  const y = TOWER.shaft,
    { mullion, curtain } = AIRPORT,
    top = y + TOWER.cab;
  const mullions = Array.from({ length: 24 }, (_, i) => {
    const a = (2 * Math.PI * i) / 24,
      at = (r: number, h: number): Vec3 => [r * Math.cos(a), h, r * Math.sin(a)];
    return member(mullion, at(8.2, y + 1.4), at(9.2, top - 0.6), [0.16, 0.2]);
  });
  const rails = [1.0, 0.5].map((h) =>
    tube(SURFACES.steel, ring(10.2, y + h), 0.04, { segments: 6 }),
  );
  return [
    lathe(
      AIRPORT.cladding,
      [
        [TOWER.radius, y - 6],
        [8.4, y - 0.4],
        [10.4, y],
        [10.4, y + 0.3],
        [8.2, y + 1.3],
        [0, y + 1.3],
      ],
      { segments: RING },
    ),
    lathe(
      curtain,
      [
        [8.2, y + 1.3],
        [9.2, top - 0.6],
      ],
      { segments: RING, caps: false },
    ),
    ...mullions,
    ...rails,
    ...ring(10.2, y)
      .filter((_, i) => i % 2 === 0)
      .map((p) => member(SURFACES.steel, p, [p[0], y + 1, p[2]], [0.05, 0.05])),
    lathe(
      AIRPORT.aluminium,
      [
        [0, top - 0.6],
        [11, top - 0.3],
        [11, top + 0.4],
        [7, top + 1.2],
        [0, top + 1.3],
      ],
      { segments: RING },
    ),
    transform(box(LIGHTS.ceiling, [8, 0.05, 8]), { at: [0, top - 0.7, 0] }),
    // Consoles along the glass, each with its screens, dark under the lit ceiling.
    ...Array.from({ length: 12 }, (_, i) => {
      const a = (2 * Math.PI * (i + 0.5)) / 12,
        place = { at: [7 * Math.cos(a), y + 1.3, 7 * Math.sin(a)] as Vec3, yaw: Math.PI / 2 - a };
      return [
        transform(box(SURFACES.darkMetal, [3.2, 1, 1]), place),
        ...[-0.8, 0, 0.8].map((x) =>
          transform(
            transform(box(LIGHTS.ceiling, [0.6, 0.4, 0.04]), { at: [x, 1.05, -0.2], pitch: -0.3 }),
            place,
          ),
        ),
      ];
    }).flat(),
  ];
}

const ring = (r: number, y: number): Vec3[] =>
  Array.from({ length: RING + 1 }, (_, i) => {
    const a = (2 * Math.PI * i) / RING;
    return [r * Math.cos(a), y, r * Math.sin(a)];
  });

function mast(): MeshPart[] {
  const top = TOWER.shaft + TOWER.cab + 1.3;
  return [
    transform(cylinder(SURFACES.steel, 0.35, 5.2, { top: 0.25, segments: 12 }), {
      at: [0, top, 0],
    }),
    transform(cylinder(SURFACES.darkMetal, 0.7, 1.4, { segments: 16, caps: true }), {
      at: [0, top + 5.2, 0],
    }),
    transform(cylinder(LIGHTS.white, 0.72, 0.5, { segments: 16 }), { at: [0, top + 5.6, 0] }),
    ...[-4, 4].map((x) =>
      transform(cylinder(SURFACES.whitePaint, 0.05, 6, { segments: 6 }), { at: [x, top, 2] }),
    ),
    transform(cone(LIGHTS.red, 0.2, 0.4, { segments: 8 }), { at: [4, top + 6, 2] }),
  ];
}

export const controlTower = (): PropMesh =>
  prop('airport/control-tower', [
    transform(box(SURFACES.concrete, [TOWER.base[0], TOWER.plinth + 0.2, TOWER.base[2]]), {
      at: [0, -TOWER.plinth, 0],
    }),
    transform(box(AIRPORT.cladding, TOWER.base), { at: [0, 0.2, 0] }),
    ...[1.5, 4.8].map((y) =>
      transform(box(AIRPORT.curtain, [TOWER.base[0] + 0.1, 1.6, TOWER.base[2] + 0.1]), {
        at: [0, y, 0],
      }),
    ),
    transform(
      extrude(SURFACES.concrete, flutes(12, TOWER.radius, 0.35), TOWER.shaft - 6, { caps: 'none' }),
      { at: [0, 0, 0] },
    ),
    transform(box(LIGHTS.ceiling, [0.8, TOWER.shaft - 12, 0.1]), {
      at: [0, 8, -TOWER.radius + 0.2],
    }),
    // Bands every 4 m up the shaft, and the equipment floor's window ring under the cab.
    ...Array.from({ length: 9 }, (_, i) =>
      transform(cylinder(AIRPORT.cladding, TOWER.radius + 0.1, 0.3, { segments: RING }), {
        at: [0, 4 + i * 4, 0],
      }),
    ),
    transform(cylinder(AIRPORT.curtain, 6.9, 1.2, { top: 7.7, segments: RING }), {
      at: [0, TOWER.shaft - 3.6, 0],
    }),
    ...cab(),
    ...mast(),
  ]);

/** A 20 m lattice radar tower and its turning antenna, a separate prop spun by a mover. */
export const RADAR_HEIGHT = 20;
export function radarProps(): PropMesh[] {
  const { steel } = SURFACES,
    legs = [
      [-2, -2],
      [2, -2],
      [2, 2],
      [-2, 2],
    ].map(([x, z]) => [x, z] as const);
  const lattice = legs.flatMap(([x, z], i) => {
    const [nx, nz] = legs[(i + 1) % 4];
    const at = (px: number, pz: number, y: number): Vec3 => [
      px * (1 - y / 60),
      y,
      pz * (1 - y / 60),
    ];
    return [
      member(steel, at(x, z, 0), at(x, z, RADAR_HEIGHT), [0.2, 0.2]),
      ...[0, 5, 10, 15].map((y) => member(steel, at(x, z, y), at(nx, nz, y + 5), [0.08, 0.08])),
    ];
  });
  const dish: MeshPart[] = [
    transform(box(SURFACES.whitePaint, [11, 3.4, 0.3]), { at: [0, 1.2, 0.9], pitch: -0.15 }),
    ...Array.from({ length: 12 }, (_, i) =>
      member(steel, [-5 + i * (10 / 11), 1.3, 0.6], [-5 + i * (10 / 11), 1.1, -0.8], [0.06, 0.06]),
    ),
    cylinder(SURFACES.darkMetal, 0.9, 1.2, { segments: 16, caps: true }),
  ];
  return [
    prop('airport/radar-tower', [
      transform(box(SURFACES.concrete, [6, 1, 6]), { at: [0, -0.8, 0] }),
      ...lattice,
      transform(box(steel, [3.4, 0.3, 3.4]), { at: [0, RADAR_HEIGHT - 0.3, 0] }),
    ]),
    prop('airport/radar-antenna', dish),
  ];
}
