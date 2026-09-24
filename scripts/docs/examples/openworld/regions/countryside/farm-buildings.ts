/**
 * Farm buildings, real size, front toward +Z, floor at y = 0 on a stone plinth: the farmhouse
 * (a long stone house with a lean-to shed), a gambrel barn with a yard floodlight, a grain silo.
 */
import type { PropMesh, Surface } from '../../plan/contract.ts';
import {
  box,
  cylinder,
  extrude,
  lathe,
  prop,
  SURFACES,
  transform,
  type PropLamp,
} from '../../props/index.ts';
import { LAND } from './ground.ts';
import { HOUSES, house, WARM } from './houses.ts';
import { door, plinth, walls, window } from './parts.ts';
import { COVERINGS, slope } from './roofs.ts';
import { PLINTH } from './site.ts';

const { wood, darkMetal, steel, emissiveLamp } = SURFACES;

/** The farmhouse: a long two-storey stone house with a lean-to shed on its east gable. */
function farmhouse(): [PropMesh, PropLamp[]] {
  const [body, lamps] = house({
      id: 'countryside/farmhouse',
      width: 16,
      depth: 9,
      floors: 2,
      wall: LAND.stone,
      roof: COVERINGS.clay,
      shutters: LAND.shutterGreen,
      windows: [5, 2],
    }),
    shed = [
      transform(plinth(5, 7), { at: [10.5, 0, 0] }),
      transform(walls(wood, 5, 7, 3), { at: [10.5, 0.3, 0] }),
      transform(box(SURFACES.slate, [5.6, 0.15, 7.8]), { at: [10.5, 3.3, 0], roll: 0.25 }),
      ...door(10.5, 3.5, 2.4, 2.4, wood),
    ];
  return [prop('countryside/farmhouse', [...body.parts, ...shed]), lamps];
}

/** A gambrel barn, 24 × 14 m, ridge along X: red boards, a slate gambrel roof, big doors. */
function barn(): [PropMesh, PropLamp[]] {
  const length = 24,
    half = 7,
    wall = 5,
    gambrel = [
      [-half, 0],
      [half, 0],
      [half, wall],
      [half * 0.62, wall + 3.4],
      [0, wall + 5],
      [-half * 0.62, wall + 3.4],
      [-half, wall],
    ] as const;
  // The profile is drawn in (z, y) and swept along X: map extrude axes (x, y, z) to (z, x, y).
  const sweep = (
    surface: Surface,
    outline: readonly (readonly [number, number])[],
    along: number,
  ) =>
    transform(extrude(surface, outline, along), [
      0,
      0,
      1,
      0,
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      0,
      -along / 2,
      0.3,
      0,
      1,
    ]);
  // The gambrel's four roof planes, tiled in slate, just proud of the boards.
  const eaves = [
      [half * 1.06, wall + 0.45],
      [half * 0.66, wall + 3.75],
      [0, wall + 5.45],
    ] as const,
    run = length / 2 + 0.5,
    roofPlanes = [0, 1].flatMap((k) => {
      const [[z0, y0], [z1, y1]] = [eaves[k], eaves[k + 1]];
      return slope(COVERINGS.slate, [-run, y0, z0], [run, y0, z0], [run, y1, z1], [-run, y1, z1]);
    });
  const lampY = 5.2;
  return [
    prop('countryside/barn', [
      plinth(length, half * 2),
      sweep(LAND.barnRed, gambrel, length),
      ...roofPlanes,
      ...roofPlanes.map((p) => transform(p, { yaw: Math.PI })),
      ...[-1, 1].flatMap((side) => [
        transform(box(wood, [4.6, 4.2, 0.12]), { at: [0, 0.3, side * (half + 0.02)] }),
        ...[-2.4, 2.4].map((x) =>
          transform(box(SURFACES.whitePaint, [0.2, 4.4, 0.16]), {
            at: [x, 0.3, side * (half + 0.03)],
          }),
        ),
      ]),
      ...[-8, 8].flatMap((x) => window(x, 2.2, half + 0.02, 1.4, 1)),
      // Board battens along both long walls, clear of the doors and windows.
      ...[-1, 1].flatMap((side) =>
        Array.from({ length: 29 }, (_, i) => -11.2 + i * 0.8)
          .filter((x) => Math.abs(x) > 2.8 && Math.abs(Math.abs(x) - 8) > 1)
          .map((x) =>
            transform(box(wood, [0.12, wall, 0.06]), { at: [x, 0.3, side * (half + 0.03)] }),
          ),
      ),
      transform(box(darkMetal, [0.1, 0.1, 0.5]), { at: [0, lampY + 0.2, half + 0.25] }),
      transform(box(emissiveLamp, [0.4, 0.08, 0.3]), { at: [0, lampY, half + 0.5] }),
    ]),
    // A yard floodlight: about 3 000 lm into the half space below, ≈ 950 cd.
    [
      {
        id: 'yard',
        type: 'spot',
        offset: [0, lampY, half + 0.5],
        direction: [0, -0.8, 0.6],
        cone: 1.1,
        color: WARM,
        intensity: 950,
        range: 30,
        night: true,
      },
    ],
  ];
}

/** A 16 m grain silo: corrugated steel drum, conical cap, a caged ladder. */
const silo = (): PropMesh =>
  prop('countryside/silo', [
    transform(cylinder(LAND.stone, 3.3, PLINTH + 0.3, { segments: 20 }), { at: [0, -PLINTH, 0] }),
    lathe(
      steel,
      [
        [3, 0.3],
        [3, 3.8],
        [3.05, 4],
        [3, 4.2],
        [3, 7.8],
        [3.05, 8],
        [3, 8.2],
        [3, 12],
        [3.05, 12.2],
        [3, 12.4],
        [3, 15.6],
        [0.5, 18.2],
        [0.3, 18.8],
      ],
      { segments: 24 },
    ),
    ...[0.6, 18].map((y) => transform(box(darkMetal, [0.5, 0.05, 0.08]), { at: [0, y, 3.1] })),
    ...[-0.22, 0.22].map((x) =>
      transform(box(darkMetal, [0.05, 17.6, 0.05]), { at: [x, 0.5, 3.12] }),
    ),
  ]);

/** Every building, with the lamps each one carries, by prop id. */
export function buildings(): { props: PropMesh[]; lamps: Map<string, readonly PropLamp[]> } {
  const made = [...HOUSES.map(house), farmhouse(), barn()],
    lamps = new Map(made.map(([p, l]) => [p.id, l] as const));
  return { props: [...made.map(([p]) => p), silo()], lamps };
}
