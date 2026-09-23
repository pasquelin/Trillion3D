/**
 * A parked articulated lorry, 16.5 m long along +X (cab at +X): a bonneted cab with sleeper,
 * chrome stacks and grille, three axles under the tractor, a ribbed box trailer on three more.
 * Two liveries. It is scenery, parked; the drivable cars are the kit's vehicles.
 */
import type { MeshPart, PropMesh, Surface } from '../../plan/contract.ts';
import { box, cylinder, prop, SURFACES, transform } from '../../props/index.ts';
import { DESERT } from './palette.ts';

const { rubber, glass, darkMetal, headlight, taillight } = SURFACES;

/** A pair of 1.05 m wheels on one axle at `x`, track 2.1 m. */
const axle = (x: number): MeshPart[] =>
  [-1, 1].flatMap((side) => [
    transform(cylinder(rubber, 0.52, 0.5, { segments: 18 }), {
      at: [x, 0.52, side * 0.8],
      pitch: (side * Math.PI) / 2,
    }),
    transform(cylinder(DESERT.chrome, 0.28, 0.52, { segments: 12 }), {
      at: [x, 0.52, side * 0.8],
      pitch: (side * Math.PI) / 2,
    }),
  ]);

function lorry(id: string, cab: Surface): PropMesh {
  const parts: MeshPart[] = [
    // Tractor: chassis, bonnet, cab, sleeper, fairing.
    transform(box(darkMetal, [6.4, 0.4, 1]), { at: [5, 0.8, 0] }),
    transform(box(cab, [1.9, 1.3, 2.2]), { at: [7.4, 1.1, 0] }),
    transform(box(cab, [2, 2.1, 2.45]), { at: [5.5, 1.1, 0] }),
    transform(box(cab, [1.6, 2.5, 2.45]), { at: [3.8, 1.1, 0] }),
    transform(box(glass, [0.05, 0.9, 2.2]), { at: [6.52, 2.1, 0], roll: 0.2 }),
    transform(box(DESERT.chrome, [0.08, 1.1, 1.3]), { at: [8.37, 1.2, 0] }),
    transform(box(DESERT.chrome, [0.3, 0.3, 2.5]), { at: [8.45, 0.7, 0] }),
    ...[-0.8, 0.8].map((z) =>
      transform(box(headlight, [0.06, 0.18, 0.3]), { at: [8.38, 1.55, z] }),
    ),
    ...[-1, 1].map((s) =>
      transform(cylinder(DESERT.chrome, 0.1, 3.3, { segments: 10 }), { at: [4.6, 1.2, s * 1.3] }),
    ),
    ...[-1, 1].map((s) => transform(box(glass, [1, 0.8, 0.05]), { at: [5.6, 2.2, s * 1.23] })),
    ...[-1, 1].map((s) =>
      transform(cylinder(DESERT.chrome, 0.32, 1.2, { segments: 14 }), {
        at: [5.2, 0.5, s * 1.1],
        roll: -Math.PI / 2,
      }),
    ),
    ...axle(7.3),
    ...axle(3.6),
    ...axle(2.4),
    // Trailer: a 13.6 m ribbed box on a fifth wheel, its three axles at the rear.
    transform(box(DESERT.trailer, [13.6, 2.7, 2.5]), { at: [-3.3, 1.3, 0] }),
    transform(box(darkMetal, [13.6, 0.25, 2.3]), { at: [-3.3, 1.05, 0] }),
    ...[-8.2, -9.5, -10.8].flatMap((x) => axle(x)),
    ...[-1, 1].map((s) =>
      transform(box(taillight, [0.05, 0.15, 0.4]), { at: [-10.12, 1.1, s * 0.95] }),
    ),
    ...[-1, 1].map((s) => transform(box(darkMetal, [0.2, 0.9, 0.2]), { at: [0.5, 0.2, s * 0.9] })),
  ];
  for (let r = 0; r < 22; r++)
    for (const s of [-1, 1])
      parts.push(
        transform(box(DESERT.trailer, [0.08, 2.6, 0.05]), {
          at: [-9.8 + r * 0.62, 1.35, s * 1.26],
        }),
      );
  return prop(id, parts);
}

export const truckProps = (): PropMesh[] => [
  lorry('desert/lorry-blue', DESERT.truckCab),
  lorry('desert/lorry-red', DESERT.forecourtRed),
];
