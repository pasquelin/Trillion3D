/**
 * Ground support equipment, nose toward +Z, standing on y = 0: a pushback tug, a baggage
 * tractor towing three covered carts, a passenger stairs truck and a fuel bowser. The buses and
 * vans of the apron are the shared vehicles.
 */
import type { MeshPart, PropMesh, Surface } from '../../plan/contract.ts';
import { box, cylinder, lathe, prop, SURFACES, transform, tube } from '../../props/index.ts';
import { AIRPORT } from './palette.ts';
import { member, repeat, wheel } from './parts.ts';

const { rubber, glass, steel, darkMetal, whitePaint } = SURFACES;

/** A pair of wheels of `radius` at ±`track`/2 on each axle `z`. */
const axles = (track: number, zs: readonly number[], radius: number, width = 0.3) =>
  zs.flatMap((z) =>
    [-1, 1].map((side) => wheel(rubber, [side * (track / 2), radius, z], radius, width, 24)),
  );

/** A cab: body, wraparound glass band, roof, beacon; front face at z = 0. */
const cab = (
  paint: Surface,
  [w, h, d]: readonly [number, number, number],
  y: number,
): MeshPart[] => [
  transform(box(paint, [w, h * 0.55, d]), { at: [0, y, -d / 2] }),
  transform(box(glass, [w - 0.05, h * 0.4, d - 0.05]), { at: [0, y + h * 0.55, -d / 2] }),
  transform(box(paint, [w + 0.05, 0.08, d + 0.05]), { at: [0, y + h * 0.95, -d / 2] }),
  transform(cylinder(SURFACES.signalAmber, 0.1, 0.15, { segments: 10, caps: true }), {
    at: [0, y + h * 0.95 + 0.08, -d / 2],
  }),
];

const tug = () =>
  prop('airport/tug', [
    transform(box(AIRPORT.tugYellow, [2.8, 1.1, 6.2]), { at: [0, 0.35, 0] }),
    transform(box(darkMetal, [2.9, 0.25, 6.3]), { at: [0, 0.3, 0] }),
    ...cab(AIRPORT.tugYellow, [1.6, 1.3, 1.6], 1.45).map((p) =>
      transform(p, { at: [0.5, 0, 2.6] }),
    ),
    transform(box(darkMetal, [0.8, 0.3, 0.4]), { at: [0, 0.5, 3.2] }),
    ...axles(2.2, [2.1, -2.1], 0.55, 0.45),
  ]);

function baggageTrain(): PropMesh {
  const cart = (z: number): MeshPart[] => [
    transform(box(steel, [1.6, 0.12, 3]), { at: [0, 0.55, z] }),
    ...[-0.75, 0.75].flatMap((x) =>
      [-1.45, 1.45].map((dz) => transform(box(steel, [0.06, 1.7, 0.06]), { at: [x, 0.6, z + dz] })),
    ),
    transform(box(AIRPORT.safetyOrange, [1.7, 0.08, 3.1]), { at: [0, 2.3, z] }),
    transform(box(whitePaint, [1.62, 0.9, 0.03]), { at: [0, 0.7, z - 1.47] }),
    ...[-1, 1].flatMap((dz) =>
      [-0.6, 0.6].map((x) => wheel(rubber, [x, 0.25, z + dz], 0.25, 0.15, 10)),
    ),
    member(steel, [0, 0.4, z + 1.5], [0, 0.4, z + 2.3], [0.06, 0.06]),
  ];
  return prop('airport/baggage-train', [
    transform(box(AIRPORT.tugYellow, [1.5, 0.9, 2.6]), { at: [0, 0.3, 4.3] }),
    ...cab(AIRPORT.tugYellow, [1.4, 1.2, 1.1], 1.2).map((p) => transform(p, { at: [0, 0, 4.4] })),
    ...axles(1.3, [5.2, 3.5], 0.35, 0.2),
    ...cart(0.9),
    ...cart(-2.9),
    ...cart(-6.7),
  ]);
}

function stairsTruck(): PropMesh {
  const steps = Array.from({ length: 18 }, (_, i) =>
    transform(box(steel, [1.4, 0.06, 0.32]), { at: [0, 1.4 + i * 0.2, -3.2 + i * 0.28] }),
  );
  return prop('airport/stairs-truck', [
    transform(box(whitePaint, [2.3, 0.7, 7.5]), { at: [0, 0.5, -0.5] }),
    ...cab(whitePaint, [2.2, 1.7, 1.6], 1.2).map((p) => transform(p, { at: [0, 0, 3.25] })),
    ...steps,
    ...[-0.72, 0.72].flatMap((x) => [
      member(steel, [x, 1.3, -3.4], [x, 5, 1.8], [0.08, 0.3]),
      tube(
        steel,
        [
          [x, 2.3, -3.4],
          [x, 6, 1.8],
          [x, 6, 3],
        ],
        0.035,
      ),
    ]),
    transform(box(steel, [1.6, 0.1, 1.4]), { at: [0, 5, 2.4] }),
    ...axles(2, [2.2, -2.8], 0.45),
  ]);
}

function fuelBowser(): PropMesh {
  const tank = lathe(
    whitePaint,
    [
      [0, 0],
      [1.1, 0.1],
      [1.25, 0.6],
      [1.25, 6.2],
      [1.1, 6.7],
      [0, 6.8],
    ],
    {
      segments: 20,
    },
  );
  return prop('airport/fuel-bowser', [
    transform(box(darkMetal, [2.2, 0.4, 9]), { at: [0, 0.6, -0.3] }),
    transform(tank, { at: [0, 2.3, -4.3], pitch: Math.PI / 2 }),
    ...cab(AIRPORT.safetyOrange, [2.4, 2.2, 1.9], 0.9).map((p) =>
      transform(p, { at: [0, 0, 4.2] }),
    ),
    ...repeat(box(steel, [2.3, 0.1, 0.1]), 3, [0, 3.55, -3.8], [0, 0, 2.6]),
    transform(cylinder(darkMetal, 0.5, 0.8, { segments: 14, caps: true }), {
      at: [1.2, 0.7, -4.2],
    }),
    ...axles(2, [3.2, -2.5, -3.7], 0.5, 0.35),
  ]);
}

export const gseProps = (): PropMesh[] => [tug(), baggageTrain(), stairsTruck(), fuelBowser()];

/** Half extents of each, for footprints: [half width, half length, centre z]. */
export const GSE_SIZE: Record<string, readonly [number, number, number]> = {
  'airport/tug': [1.5, 3.2, 0],
  'airport/baggage-train': [0.9, 7, -2.8],
  'airport/stairs-truck': [1.2, 4.3, -0.3],
  'airport/fuel-bowser': [1.3, 5.2, 0.4],
};
