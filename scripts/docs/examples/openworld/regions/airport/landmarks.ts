/**
 * The landside's larger buildings: the airport hotel (twelve storeys of glass bays, each room
 * with its balcony and railing, a lit crown), the multi-storey car park (five open decks on a
 * column grid, parapets, a helical ramp, deck lights) and the airport fire station (four
 * glazed engine bays, a drill tower, a hose-drying mast).
 */
import type { MeshPart, PropMesh } from '../../plan/contract.ts';
import { box, cylinder, lathe, prop, SURFACES, transform, tube } from '../../props/index.ts';
import { AIRPORT, LIGHTS } from './palette.ts';
import { member, repeat } from './parts.ts';

export const HOTEL = {
  width: 60,
  depth: 18,
  storey: 3.4,
  floors: 12,
  bay: 4,
  plinth: 1.5,
} as const;
export const GARAGE = { width: 80, depth: 48, deck: 3.1, decks: 5, plinth: 0.8 } as const;
/** Column lines of the garage along X: bays sit three to a gap between them. */
export const GARAGE_COLUMNS = Array.from({ length: 9 }, (_, i) => -GARAGE.width / 2 + 4 + i * 9);
export const STATION = { width: 40, depth: 26, height: 8, plinth: 1 } as const;

/** One hotel room's face: frame, glass, a balcony slab with its railing, facing +Z at z = 0. */
function room(x: number, y: number): MeshPart[] {
  const w = HOTEL.bay,
    { mullion, curtain } = AIRPORT;
  return [
    transform(box(curtain, [w - 0.3, HOTEL.storey - 0.5, 0.05]), { at: [x, y + 0.3, -0.2] }),
    transform(box(mullion, [0.12, HOTEL.storey - 0.4, 0.2]), {
      at: [x - w / 2 + 0.06, y + 0.2, 0],
    }),
    transform(box(SURFACES.whitePaint, [w, 0.2, 1.6]), { at: [x, y, 0.8] }),
    tube(
      SURFACES.steel,
      [
        [x - w / 2 + 0.1, y + 1.1, 1.5],
        [x + w / 2 - 0.1, y + 1.1, 1.5],
      ],
      0.03,
      { segments: 6 },
    ),
    ...repeat(
      box(SURFACES.steel, [0.03, 0.9, 0.03]),
      9,
      [x - w / 2 + 0.2, y + 0.2, 1.5],
      [0.45, 0, 0],
    ),
    transform(box(AIRPORT.curtain, [0.04, 1, 1.5]), { at: [x + w / 2 - 0.02, y + 0.2, 0.8] }),
  ];
}

function hotel(): PropMesh {
  const { width: w, depth: d, storey, floors } = HOTEL,
    top = floors * storey + 4,
    bays = Math.round(w / HOTEL.bay);
  const faces = [1, -1].flatMap((side) =>
    Array.from({ length: floors - 1 }, (_, f) =>
      Array.from({ length: bays }, (_, b) =>
        room(-w / 2 + HOTEL.bay * (b + 0.5), 4 + f * storey),
      ).flat(),
    )
      .flat()
      .map((part) => transform(part, { at: [0, 0, (side * d) / 2], yaw: side > 0 ? 0 : Math.PI })),
  );
  return prop('airport/hotel', [
    transform(box(SURFACES.concrete, [w + 2, HOTEL.plinth + 0.2, d + 2]), {
      at: [0, -HOTEL.plinth, 0],
    }),
    transform(box(AIRPORT.cladding, [w - 0.2, top, d - 0.4]), { at: [0, 0, 0] }),
    transform(box(AIRPORT.curtain, [w + 0.2, 3.6, d + 0.2]), { at: [0, 0.2, 0] }),
    transform(box(SURFACES.whitePaint, [w + 6, 0.5, d + 8]), { at: [0, 3.8, 0] }),
    ...faces,
    transform(box(AIRPORT.aluminium, [w + 1, 3, d + 1]), { at: [0, top, 0] }),
    transform(box(SURFACES.emissiveWindow, [w - 6, 1.2, 0.1]), {
      at: [0, top + 0.9, d / 2 + 0.55],
    }),
    ...[-18, 0, 18].map((x) =>
      transform(box(SURFACES.darkMetal, [6, 2.5, 5]), { at: [x, top + 3, 0] }),
    ),
  ]);
}

function garage(): PropMesh {
  const { width: w, depth: d, deck, decks } = GARAGE,
    columns = GARAGE_COLUMNS.flatMap((x) =>
      [-d / 2 + 2, -6, 6, d / 2 - 2].map((z) =>
        transform(cylinder(SURFACES.concrete, 0.35, decks * deck, { segments: 12 }), {
          at: [x, 0, z],
        }),
      ),
    );
  const levels = Array.from({ length: decks }, (_, k) => {
    const y = (k + 1) * deck - 0.35;
    return [
      transform(box(SURFACES.concrete, [w, 0.35, d]), { at: [0, y, 0] }),
      ...[-1, 1].map((side) =>
        transform(box(SURFACES.concrete, [w, 1.1, 0.2]), { at: [0, y + 0.35, (side * d) / 2] }),
      ),
      ...[-1, 1].map((side) =>
        transform(box(SURFACES.concrete, [0.2, 1.1, d]), { at: [(side * w) / 2, y + 0.35, 0] }),
      ),
      ...repeat(box(LIGHTS.ceiling, [1.2, 0.05, 0.3]), 8, [-w / 2 + 8, y - 0.05, 0], [9, 0, 0]),
      ...repeat(
        box(SURFACES.whitePaint, [0.12, 0.01, 5]),
        30,
        [-w / 2 + 3, y + 0.35, -d / 2 + 5],
        [2.5, 0, 0],
      ),
      // Screens of perforated metal between fins along both long edges.
      ...[-1, 1].flatMap((side) =>
        repeat(
          box(AIRPORT.chainLink, [1.45, 1.6, 0.05]),
          50,
          [-w / 2 + 0.8, y + 1.45, side * (d / 2 + 0.2)],
          [1.6, 0, 0],
        ),
      ),
    ];
  }).flat();
  const helix = Array.from({ length: 5 * 24 + 1 }, (_, i) => {
    const a = (i / 24) * 2 * Math.PI;
    return [w / 2 + 9 + 7 * Math.cos(a), 0.3 + (i / 24) * deck, 7 * Math.sin(a)] as const;
  });
  const fins = [-1, 1].flatMap((side) =>
    repeat(
      box(SURFACES.concrete, [0.15, decks * deck + 1, 0.6]),
      51,
      [-w / 2, 0, side * (d / 2 + 0.3)],
      [1.6, 0, 0],
    ),
  );
  return prop('airport/parking-garage', [
    ...fins,
    transform(box(SURFACES.concrete, [w, GARAGE.plinth + 0.2, d]), { at: [0, -GARAGE.plinth, 0] }),
    transform(box(SURFACES.asphalt, [w, 0.2, d]), { at: [0, 0, 0] }),
    ...columns,
    ...levels,
    tube(
      SURFACES.concrete,
      helix.map(([x, y, z]) => [x, y, z]),
      3.2,
      { segments: 6 },
    ),
    transform(cylinder(SURFACES.concrete, 2, decks * deck + 1, { segments: 20 }), {
      at: [w / 2 + 9, 0, 0],
    }),
    transform(box(SURFACES.signBlue, [4, 4, 0.2]), { at: [-w / 2 + 3, decks * deck + 1, d / 2] }),
  ]);
}

function fireStation(): PropMesh {
  const { width: w, depth: d, height: h } = STATION;
  const doors = [-15, -5, 5, 15].flatMap((x) => [
    transform(box(AIRPORT.curtain, [8, 5.5, 0.1]), { at: [x, 0.2, d / 2 + 0.05] }),
    ...repeat(box(AIRPORT.mullion, [8, 0.08, 0.14]), 6, [x, 0.9, d / 2 + 0.1], [0, 0.9, 0]),
    transform(box(SURFACES.signRed, [9, 0.8, 0.2]), { at: [x, 6, d / 2 + 0.1] }),
  ]);
  return prop('airport/fire-station', [
    transform(box(SURFACES.concrete, [w + 1, STATION.plinth + 0.2, d + 1]), {
      at: [0, -STATION.plinth, 0],
    }),
    transform(box(SURFACES.brick, [w, h, d]), { at: [0, 0.2, 0] }),
    transform(box(AIRPORT.roofMembrane, [w + 1, 0.4, d + 1]), { at: [0, h + 0.2, 0] }),
    ...doors,
    transform(box(SURFACES.brick, [5, 20, 5]), { at: [w / 2 - 2.5, 0.2, -d / 2 - 2.5] }),
    ...repeat(box(AIRPORT.curtain, [0.1, 1.4, 1]), 5, [w / 2 + 0.05, 3, -d / 2 - 2.5], [0, 3.4, 0]),
    member(SURFACES.steel, [-w / 2 - 3, 0, 0], [-w / 2 - 3, 16, 0], [0.4, 0.4]),
    transform(
      lathe(
        SURFACES.signRed,
        [
          [1.5, 0],
          [1.5, 0.6],
          [0, 0.8],
        ],
        { segments: 16 },
      ),
      { at: [-w / 2 - 3, 16, 0] },
    ),
  ]);
}

export const landmarkProps = (): PropMesh[] => [hotel(), garage(), fireStation()];
