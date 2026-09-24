/**
 * Small craft and sea marks: a 12 m inshore fishing boat (wheelhouse, mast and derrick, net
 * drum, gunwale), a 4 m rowing boat with its oars, and a mooring buoy. Bow toward +Z, origin
 * on the waterline at mid-length, like the shared boats.
 */
import type { MeshPart, PropMesh, Surface } from '../../../plan/contract.ts';
import {
  box,
  roundedBox,
  cylinder,
  hull,
  lathe,
  prop,
  SURFACES,
  transform,
  tube,
} from '../../../props/index.ts';
import { COAST } from '../surfaces.ts';

/**
 * A rubbing strake along both sides of a kit hull of `length` × `beam` × `freeboard`, on its
 * sheer: full beam aft, narrowing and rising toward the stem.
 */
function gunwale(length: number, beam: number, freeboard: number, radius: number): MeshPart[] {
  return [-1, 1].map((side) =>
    tube(
      SURFACES.wood,
      Array.from({ length: 13 }, (_, i) => {
        const t = 0.02 + (i / 12) * 0.95,
          bow = Math.max(0, (t - 0.5) / 0.5);
        return [
          side * (beam / 2) * Math.max(0.05, Math.pow(1 - bow * bow, 0.75)),
          freeboard * (1 + 0.35 * bow * bow),
          length * (t - 0.5),
        ] as const;
      }),
      radius,
      { segments: 6 },
    ),
  );
}

function fishingBoat(id: string, paint: Surface): PropMesh {
  const parts: MeshPart[] = [
    hull(paint, { length: 12, beam: 4.2, draft: 1.4, freeboard: 1.2, fullness: 0.75 }),
    ...gunwale(12, 4.2, 1.2, 0.08),
    transform(box(COAST.deckWood, [3.6, 0.1, 9.5]), { at: [0, 1.0, -0.4] }),
    transform(roundedBox(COAST.whitewash, [2.6, 2.2, 2.8], 0.12, 3), { at: [0, 1.1, 1.4] }),
    transform(box(SURFACES.glass, [2.4, 0.7, 0.05]), { at: [0, 2.3, 2.82] }),
    ...[-1, 1].map((s) =>
      transform(box(SURFACES.glass, [0.05, 0.7, 2]), { at: [s * 1.31, 2.3, 1.4] }),
    ),
    transform(roundedBox(paint, [2.9, 0.15, 3.1], 0.05, 2), { at: [0, 3.3, 1.4] }),
    transform(cylinder(SURFACES.steel, 0.1, 7.5, { segments: 8 }), { at: [0, 3.4, 1.6] }),
    tube(
      SURFACES.steel,
      [
        [0, 5.2, 1.6],
        [0, 3.2, -3.8],
      ],
      0.07,
      { segments: 6 },
    ),
    tube(
      SURFACES.darkMetal,
      [
        [0, 10.8, 1.6],
        [0, 3.2, -3.8],
      ],
      0.015,
      { segments: 4 },
    ),
    transform(cylinder(SURFACES.rubber, 0.6, 1.8, { segments: 16 }), {
      at: [0.9, 1.9, -2.6],
      roll: Math.PI / 2,
    }),
    transform(cylinder(SURFACES.darkMetal, 0.2, 1.2, { segments: 8 }), { at: [0.8, 3.3, 0.4] }),
  ];
  for (let i = 0; i < 6; i++)
    parts.push(
      transform(roundedBox(COAST.buoyOrange, [0.6, 0.35, 0.4], 0.04, 2), {
        at: [-1.3 + (i % 3) * 0.65, 1.05, -4.2 + Math.floor(i / 3) * 0.45],
      }),
    );
  return prop(id, parts);
}

function rowingBoat(): PropMesh {
  const parts: MeshPart[] = [
    hull(COAST.hullGreen, {
      length: 4,
      beam: 1.4,
      draft: 0.35,
      freeboard: 0.4,
      around: 24,
      along: 30,
    }),
    ...gunwale(4, 1.4, 0.4, 0.04),
    ...[-0.8, 0.2, 1.1].map((z) =>
      transform(box(SURFACES.wood, [1.3, 0.05, 0.25]), { at: [0, 0.2, z] }),
    ),
  ];
  for (const side of [-1, 1])
    parts.push(
      tube(
        SURFACES.wood,
        [
          [side * 0.35, 0.3, -0.9],
          [side * 0.3, 0.3, 1.5],
        ],
        0.03,
        { segments: 5 },
      ),
    );
  return prop('coast-rowing-boat', parts);
}

const mooringBuoy = (): PropMesh =>
  prop('coast-buoy', [
    lathe(
      COAST.buoyOrange,
      [
        [0, -0.5],
        [0.55, -0.3],
        [0.6, 0.2],
        [0.4, 0.5],
        [0, 0.55],
      ],
      { segments: 14 },
    ),
    transform(cylinder(SURFACES.darkMetal, 0.04, 1.4, { segments: 5 }), { at: [0, 0.5, 0] }),
    transform(cylinder(COAST.buoyOrange, 0.18, 0.3, { segments: 8, top: 0 }), { at: [0, 1.9, 0] }),
  ]);

export const marineProps = (): PropMesh[] => [
  fishingBoat('coast-fishing-boat-blue', COAST.hullBlue),
  fishingBoat('coast-fishing-boat-red', SURFACES.hullRed),
  rowingBoat(),
  mooringBuoy(),
];
