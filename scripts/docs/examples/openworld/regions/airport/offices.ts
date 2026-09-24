/**
 * Office blocks of the airport business park: a glass box on a recessed lobby, every window
 * bay framed on every floor, spandrel bands, full-height aluminium fins, a parapet and rooftop
 * plant. One builder, two sizes: a long 8-storey block and a 14-storey square tower.
 */
import type { MeshPart, PropMesh } from '../../plan/contract.ts';
import { box, prop, SURFACES, transform } from '../../props/index.ts';
import { AIRPORT, LIGHTS } from './palette.ts';
import type { Footprint } from './placer.ts';

export type OfficeSize = { width: number; depth: number; floors: number };
export const OFFICES = {
  long: { width: 48, depth: 22, floors: 8 },
  tower: { width: 30, depth: 30, floors: 14 },
} as const satisfies Record<string, OfficeSize>;
export const OFFICE_PLINTH = 1.2;
const STOREY = 3.8,
  BAY = 1.5,
  LOBBY = 4.5;

/** One facade of `length` at z = 0 facing +Z, floors above the lobby. */
function facade(length: number, floors: number): MeshPart[] {
  const bays = Math.round(length / BAY),
    step = length / bays,
    { mullion, aluminium, curtain } = AIRPORT;
  const frames = Array.from({ length: floors }, (_, f) => {
    const y = LOBBY + f * STOREY;
    return [
      transform(box(AIRPORT.cladding, [length, 0.9, 0.3]), { at: [0, y, 0] }),
      ...Array.from({ length: bays }, (_, b) => {
        const x = -length / 2 + step * (b + 0.5);
        return [
          transform(box(mullion, [step - 0.1, 0.08, 0.12]), { at: [x, y + 0.9, 0.02] }),
          transform(box(mullion, [step - 0.1, 0.08, 0.12]), { at: [x, y + STOREY - 0.08, 0.02] }),
          transform(box(mullion, [0.08, STOREY - 0.9, 0.12]), {
            at: [x - step / 2 + 0.09, y + 0.9, 0.02],
          }),
        ];
      }).flat(),
    ];
  }).flat();
  const fins = Array.from({ length: bays + 1 }, (_, b) =>
    transform(box(aluminium, [0.1, floors * STOREY, 0.5]), {
      at: [-length / 2 + step * b, LOBBY, 0.25],
    }),
  );
  return [
    transform(box(curtain, [length, floors * STOREY, 0.05]), { at: [0, LOBBY, -0.1] }),
    ...frames,
    ...fins,
    transform(box(curtain, [length - 3, LOBBY - 0.3, 0.1]), { at: [0, 0.2, -1.5] }),
    transform(box(LIGHTS.ceiling, [length - 3, 0.05, 1.4]), { at: [0, LOBBY - 0.1, -0.75] }),
  ];
}

export function office(id: string, size: OfficeSize): PropMesh {
  const { width: w, depth: d, floors } = size,
    top = LOBBY + floors * STOREY;
  const sides = [
    { length: w, at: d / 2, yaw: 0 },
    { length: w, at: d / 2, yaw: Math.PI },
    { length: d, at: w / 2, yaw: Math.PI / 2 },
    { length: d, at: w / 2, yaw: -Math.PI / 2 },
  ].flatMap(({ length, at, yaw }) =>
    facade(length, floors).map((part) => transform(transform(part, { at: [0, 0, at] }), { yaw })),
  );
  return prop(id, [
    transform(box(SURFACES.concrete, [w + 2, OFFICE_PLINTH + 0.2, d + 2]), {
      at: [0, -OFFICE_PLINTH, 0],
    }),
    transform(box(AIRPORT.cladding, [w - 3, LOBBY, d - 3]), { at: [0, 0.2, 0] }),
    transform(box(AIRPORT.cladding, [w - 0.6, top - LOBBY, d - 0.6]), { at: [0, LOBBY, 0] }),
    ...sides,
    transform(box(AIRPORT.cladding, [w + 0.6, 1.2, d + 0.6]), { at: [0, top, 0] }),
    transform(box(SURFACES.darkMetal, [w * 0.5, 3, d * 0.4]), { at: [0, top, 0] }),
    ...[-1, 1].map((side) =>
      transform(box(SURFACES.steel, [2.5, 1.8, 2.5]), { at: [side * w * 0.35, top + 1.2, 0] }),
    ),
  ]);
}

export const officeFootprint = ({ width, depth }: OfficeSize): Footprint => [
  [0, 0, width / 2 + 1, depth / 2 + 1],
];
