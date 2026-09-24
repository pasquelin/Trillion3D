/**
 * Mid-rise apartment blocks (5 – 9 floors) that ring downtown: a rendered body on a stone
 * ground floor, framed windows with lit rooms, balconies on the street and courtyard faces, a
 * parapet and a stair head on the roof. Six variants differ in length, height, colour and rhythm.
 */
import type { PropMesh, Surface } from '../../plan/contract.ts';
import { box, prop, transform } from '../../props/index.ts';
import type { Xz } from './frame.ts';
import { edgesOf, punchedWall, rectangle } from './facade.ts';
import { CITY } from './surfaces.ts';
import { FOUNDATION, flatRoof } from './tower-kit.ts';

const FLOOR = 3.1;
const GROUND = 4.2;

type Midrise = { id: string; size: Xz; floors: number; body: Surface; bay: number; seed: number };

/** A mid-rise, its footprint's half extents and the height of its flat roof. */
export type Block = { prop: PropMesh; half: Xz; roof: number };

function midrise({ id, size: [w, d], floors, body, bay, seed }: Midrise): Block {
  const outline = rectangle(w, d),
    top = GROUND + floors * FLOOR,
    edges = edgesOf(outline),
    // The long faces (street and courtyard) carry the balconies.
    long = (i: number) => edges[i].length > Math.min(w, d) + 0.1;
  const walls = edges.flatMap((edge, i) => [
    ...punchedWall(edge, GROUND, floors, {
      window: 1.4,
      floor: FLOOR,
      bay,
      lit: 0.3,
      seed: seed + i,
      ...(long(i) ? { balcony: CITY.railing } : {}),
    }),
  ]);
  const shopfronts = edgesOf(rectangle(w + 0.3, d + 0.3)).flatMap((edge, i) =>
    punchedWall(edge, 0.4, 1, {
      window: bay - 0.9,
      floor: GROUND,
      bay,
      lit: 0.55,
      seed: seed + 9 + i,
    }),
  );
  return {
    prop: prop(id, [
      transform(box(CITY.stone, [w + 0.3, FOUNDATION + GROUND, d + 0.3]), {
        at: [0, -FOUNDATION, 0],
      }),
      transform(box(body, [w, top - GROUND, d]), { at: [0, GROUND, 0] }),
      transform(box(CITY.stone, [w + 0.6, 0.35, d + 0.6]), { at: [0, GROUND - 0.2, 0] }),
      ...walls,
      ...shopfronts,
      ...flatRoof(w, d, CITY.stone).map((part) => transform(part, { at: [0, top, 0] })),
    ]),
    half: [w / 2 + 0.3, d / 2 + 0.3],
    roof: top,
  };
}

/** Six mid-rise variants, 34 – 44 m long and 14 – 16 m deep, long side along X. */
export const midrises = (seed: number): Block[] => [
  midrise({
    id: 'city/midrise-cream',
    size: [40, 15],
    floors: 6,
    body: CITY.render,
    bay: 3.4,
    seed,
  }),
  midrise({
    id: 'city/midrise-terracotta',
    size: [36, 14],
    floors: 5,
    body: CITY.renderTerracotta,
    bay: 3.2,
    seed: seed + 20,
  }),
  midrise({
    id: 'city/midrise-grey',
    size: [40, 16],
    floors: 9,
    body: CITY.renderGrey,
    bay: 3.6,
    seed: seed + 40,
  }),
  midrise({
    id: 'city/midrise-brick',
    size: [34, 15],
    floors: 7,
    body: CITY.brickStack,
    bay: 3.3,
    seed: seed + 60,
  }),
  midrise({
    id: 'city/midrise-ivory',
    size: [44, 16],
    floors: 8,
    body: CITY.stone,
    bay: 3.4,
    seed: seed + 80,
  }),
  midrise({
    id: 'city/midrise-loft',
    size: [38, 15],
    floors: 5,
    body: CITY.renderTerracotta,
    bay: 4.4,
    seed: seed + 100,
  }),
];
