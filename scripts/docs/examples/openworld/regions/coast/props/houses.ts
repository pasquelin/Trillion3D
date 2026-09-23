/**
 * Fishermen's houses: rendered walls on a granite plinth, framed windows with shutters on every
 * floor, a door, a tiled roof with a chimney, and on some a first-floor balcony facing the
 * sea. The front (+Z) faces the water. The plinth sinks `PLINTH` metres below the origin, so a
 * house set on the lowest corner of a gentle slope never shows a gap.
 */
import type { MeshPart, PropMesh, Surface, Vec3 } from '../../../plan/contract.ts';
import { box, cylinder, prop, roundedBox, SURFACES, transform } from '../../../props/index.ts';
import { COAST } from '../surfaces.ts';
import { framedDoor, framedWindow, tiledRoof } from './facade.ts';

/** Depth of the plinth under the origin, metres. */
export const PLINTH = 1.2;
const STOREY = 3;

export type HouseSpec = {
  width: number;
  depth: number;
  floors: number;
  wall: Surface;
  roof: Surface;
  shutter: Surface;
  balcony: boolean;
  seed: number;
};

/** Windows along one wall of `length`, each floor, lit or dark by the seed. */
function windowsOn(length: number, spec: HouseSpec, turn: number, reach: number): MeshPart[] {
  const count = Math.max(1, Math.floor(length / 2.6)),
    parts: MeshPart[] = [];
  for (let floor = 0; floor < spec.floors; floor++)
    for (let i = 0; i < count; i++) {
      const x = -length / 2 + ((i + 0.5) / count) * length;
      // The ground floor's middle bay on the front is the door.
      if (floor === 0 && turn === 0 && i === Math.floor(count / 2)) continue;
      const pane = (spec.seed + floor * 3 + i) % 4 === 0 ? SURFACES.emissiveWindow : SURFACES.glass;
      for (const part of framedWindow(1.1, 1.4, pane, spec.shutter))
        parts.push(
          transform(transform(part, { at: [x, floor * STOREY + 1, reach] }), { yaw: turn }),
        );
    }
  return parts;
}

/** A balcony across the front of the first floor: slab, balusters, a rail. */
function balcony(width: number, reach: number): MeshPart[] {
  const parts = [
    transform(roundedBox(COAST.quayStone, [width * 0.7, 0.15, 1.1], 0.04, 2), {
      at: [0, STOREY, reach + 0.55],
    }),
  ];
  const posts = Math.round(width * 0.7 * 5);
  for (let i = 0; i <= posts; i++)
    parts.push(
      transform(cylinder(SURFACES.darkMetal, 0.02, 0.95, { segments: 4, caps: false }), {
        at: [-width * 0.35 + (i / posts) * width * 0.7, STOREY + 0.15, reach + 1.05],
      }),
    );
  parts.push(
    transform(box(SURFACES.darkMetal, [width * 0.7, 0.05, 0.06]), {
      at: [0, STOREY + 1.1, reach + 1.05],
    }),
  );
  return parts;
}

export function house(id: string, spec: HouseSpec): PropMesh {
  const { width, depth, floors } = spec,
    height = floors * STOREY,
    front: Vec3 = [0, 0, depth / 2 + 0.02];
  const parts: MeshPart[] = [
    transform(roundedBox(COAST.granite, [width + 0.3, PLINTH + 0.5, depth + 0.3], 0.06, 2), {
      at: [0, -PLINTH, 0],
    }),
    transform(roundedBox(spec.wall, [width, height - 0.5, depth], 0.1, 3), { at: [0, 0.5, 0] }),
    ...framedDoor(1.1, 2.2, spec.shutter).map((p) => transform(p, { at: [0, 0.5, front[2]] })),
    ...windowsOn(width, spec, 0, front[2]),
    ...windowsOn(width, spec, Math.PI, depth / 2 + 0.02),
    ...windowsOn(depth, spec, Math.PI / 2, width / 2 + 0.02),
    ...windowsOn(depth, spec, -Math.PI / 2, width / 2 + 0.02),
    ...tiledRoof(spec.roof, width, depth, depth * 0.38).map((p) =>
      transform(p, { at: [0, height, 0] }),
    ),
    transform(roundedBox(COAST.whitewash, [0.8, 2.2, 0.8], 0.05, 2), {
      at: [width * 0.3, height + depth * 0.1, -depth * 0.2],
    }),
    transform(box(COAST.quayStone, [1, 0.12, 1]), {
      at: [width * 0.3, height + depth * 0.1 + 2.2, -depth * 0.2],
    }),
    transform(cylinder(COAST.terracotta, 0.15, 0.5, { segments: 8 }), {
      at: [width * 0.3, height + depth * 0.1 + 2.32, -depth * 0.2],
    }),
  ];
  if (spec.balcony && floors > 1) parts.push(...balcony(width, front[2]));
  return prop(id, parts);
}

/** The coast's house types: cottages, tall harbour houses, a long fishermen's row, a wide villa. */
export const HOUSES: readonly (Omit<HouseSpec, 'seed'> & { id: string })[] = [
  {
    id: 'coast-house-cottage-white',
    width: 7,
    depth: 6,
    floors: 1,
    wall: COAST.whitewash,
    roof: SURFACES.slate,
    shutter: COAST.seaBlue,
    balcony: false,
  },
  {
    id: 'coast-house-cottage-ochre',
    width: 8,
    depth: 6.5,
    floors: 1,
    wall: COAST.ochre,
    roof: COAST.terracotta,
    shutter: COAST.shutterGreen,
    balcony: false,
  },
  {
    id: 'coast-house-harbour',
    width: 6.5,
    depth: 7,
    floors: 3,
    wall: COAST.whitewash,
    roof: SURFACES.slate,
    shutter: COAST.shutterGreen,
    balcony: true,
  },
  {
    id: 'coast-house-narrow',
    width: 5,
    depth: 8,
    floors: 3,
    wall: COAST.ochre,
    roof: SURFACES.slate,
    shutter: COAST.seaBlue,
    balcony: false,
  },
  {
    id: 'coast-house-long',
    width: 14,
    depth: 6,
    floors: 1,
    wall: COAST.whitewash,
    roof: COAST.terracotta,
    shutter: COAST.seaBlue,
    balcony: false,
  },
  {
    id: 'coast-house-wide',
    width: 11,
    depth: 8,
    floors: 2,
    wall: COAST.ochre,
    roof: COAST.terracotta,
    shutter: COAST.seaBlue,
    balcony: true,
  },
];

export const houseProps = (seed: number): PropMesh[] =>
  HOUSES.map(({ id, ...spec }, index) => house(id, { ...spec, seed: seed + index }));
