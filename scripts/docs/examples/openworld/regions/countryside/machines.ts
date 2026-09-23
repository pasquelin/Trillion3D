/**
 * Things of the farm that are not buildings: a tower windmill (its sails a separate prop the page
 * spins), a tractor (parked, or driving a track as a mover) and round hay bales. Real sizes,
 * front toward +Z.
 */
import type { MeshPart, PropMesh, Vec3 } from '../../plan/contract.ts';
import {
  box,
  cylinder,
  lathe,
  prop,
  roundedBox,
  sphere,
  SURFACES,
  transform,
} from '../../props/index.ts';
import { LAND } from './ground.ts';
import { door, window } from './parts.ts';
import { PLINTH } from './site.ts';

const { plaster, wood, slate, darkMetal, rubber, steel, glass } = SURFACES;
const SIDEWAYS = Math.PI / 2;

/** The windmill's hub in the tower's frame, and the sails' reach. */
export const WINDMILL = { hub: [0, 15.2, 4.4] as Vec3, sail: 11 };

/** A tower mill: whitewashed tapering tower, a reefing stage, a wooden boat-shaped cap. */
export const windmillTower = (): PropMesh =>
  prop('countryside/windmill-tower', [
    transform(cylinder(LAND.stone, 4.8, PLINTH + 0.3, { segments: 20 }), { at: [0, -PLINTH, 0] }),
    lathe(
      plaster,
      [
        [4.4, 0.3],
        [4.1, 5],
        [3.6, 11],
        [3.4, 13.2],
      ],
      { segments: 20, caps: false },
    ),
    transform(cylinder(wood, 5.6, 0.2, { segments: 20 }), { at: [0, 5, 0] }),
    ...Array.from({ length: 16 }, (_, i) => {
      const a = (i / 16) * Math.PI * 2;
      return transform(box(wood, [0.08, 1, 0.08]), {
        at: [Math.cos(a) * 5.45, 5.2, Math.sin(a) * 5.45],
      });
    }),
    transform(cylinder(wood, 5.5, 0.08, { top: 5.45, segments: 20 }), { at: [0, 6.15, 0] }),
    lathe(
      slate,
      [
        [3.7, 13.2],
        [3.7, 14],
        [3.1, 16.2],
        [1.6, 17.6],
        [0, 18],
      ],
      { segments: 16 },
    ),
    transform(cylinder(wood, 0.55, 2.2, { segments: 10 }), { at: [0, 15.2, 2.4], pitch: SIDEWAYS }),
    ...door(0, 4.35, 1.2, 2.3),
    ...[2.2, 7.6, 10.6]
      .flatMap((y) => window(0, y, 4.2 - y * 0.06, 0.7, 1))
      .map((p) => transform(p, { yaw: Math.PI })),
  ]);

/** One sail along +Y: the stock, a lattice of bars, and cloth on both faces. */
function sail(reach: number): MeshPart[] {
  const width = 2.2,
    from = 2,
    bars = Array.from({ length: Math.round(reach - from) + 1 }, (_, i) =>
      transform(box(wood, [width, 0.06, 0.06]), { at: [width / 2 - 0.2, from + i, 0.12] }),
    );
  return [
    box(wood, [0.3, reach, 0.25]),
    ...bars,
    transform(box(wood, [0.08, reach - from, 0.08]), { at: [width - 0.2, from, 0.12] }),
    transform(box(LAND.cloth, [width - 0.3, reach - from - 0.4, 0.01]), {
      at: [width / 2 - 0.2, from + 0.2, 0.2],
    }),
  ];
}

/** Four sails round a hub in the XY plane, spinning about local +Z; origin at the hub. */
export const windmillSails = (): PropMesh =>
  prop('countryside/windmill-sails', [
    transform(sphere(darkMetal, 0.7, { segments: 10, rings: 6 }), { at: [0, 0, 0.3] }),
    ...[0, 1, 2, 3].flatMap((i) =>
      sail(WINDMILL.sail).map((p) => transform(p, { roll: (i * Math.PI) / 2 })),
    ),
  ]);

/** A tyre with a rounded shoulder and a hub, its axle along X, centred at `at`, facing `side`. */
function wheel(radius: number, width: number, at: Vec3, side: number): MeshPart[] {
  const w = width / 2,
    tyre = lathe(
      rubber,
      [
        [radius * 0.62, -w],
        [radius * 0.93, -w],
        [radius, -w * 0.6],
        [radius, w * 0.6],
        [radius * 0.93, w],
        [radius * 0.62, w],
      ],
      { segments: 32 },
    );
  return [
    transform(tyre, { at, roll: SIDEWAYS }),
    transform(cylinder(SURFACES.craneYellow, radius * 0.62, width * 0.9, { segments: 20 }), {
      at: [at[0] - (side * width * 0.9) / 2, at[1], at[2]],
      roll: side * SIDEWAYS,
    }),
  ];
}

/** A farm tractor, 4.3 m long: rounded hood and cab, big rear wheels, exhaust, mudguards. */
export const tractor = (): PropMesh =>
  prop('countryside/tractor', [
    transform(roundedBox(LAND.tractor, [1.1, 1, 2.2], 0.12, 3), { at: [0, 0.8, 0.9] }),
    transform(roundedBox(LAND.tractor, [1.4, 0.5, 1.6], 0.08, 3), { at: [0, 0.7, -0.8] }),
    transform(roundedBox(darkMetal, [1.4, 0.1, 1.6], 0.04, 2), { at: [0, 2.9, -0.8] }),
    transform(box(glass, [1.2, 1.7, 1.3]), { at: [0, 1.2, -0.8] }),
    ...[-0.62, 0.62].flatMap((x) =>
      [-1.45, -0.15].map((z) => transform(box(darkMetal, [0.06, 1.7, 0.06]), { at: [x, 1.2, z] })),
    ),
    ...[-1, 1].flatMap((s) => [
      ...wheel(0.85, 0.5, [s * 0.95, 0.85, -0.9], s),
      ...wheel(0.48, 0.3, [s * 0.8, 0.48, 1.55], s),
      transform(roundedBox(LAND.tractor, [0.6, 0.08, 1.5], 0.03, 2), {
        at: [s * 1.05, 1.75, -0.9],
      }),
    ]),
    transform(cylinder(steel, 0.06, 1.3, { segments: 10 }), { at: [0.4, 1.8, 1.5] }),
    transform(roundedBox(darkMetal, [0.9, 0.25, 0.12], 0.04, 2), { at: [0, 0.85, 2.02] }),
    ...[-0.35, 0.35].map((x) =>
      transform(box(SURFACES.headlight, [0.2, 0.12, 0.04]), { at: [x, 1.45, 2.01] }),
    ),
  ]);

/** Three round hay bales, two side by side and one on top. */
export const hayBales = (): PropMesh =>
  prop('countryside/hay-bales', [
    ...[
      [-0.65, 0.75],
      [0.65, 0.75],
      [0, 2.05],
    ].map(([x, y]) =>
      transform(cylinder(LAND.hay, 0.75, 1.3, { segments: 16 }), {
        at: [x, y, -0.65],
        pitch: SIDEWAYS,
      }),
    ),
  ]);
