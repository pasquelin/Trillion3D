/**
 * The suburbs: six detached houses (a two-storey gable, a hipped bungalow with its garage, a
 * blue clapboard house with a porch, a flat-roofed modern house, a duplex, a brick cottage) and a white picket fence run
 * sized to the garden lots. Houses face +Z (the street), stand on a foundation that reaches
 * 4 m under the ground, and carry framed windows, a door and a chimney.
 */
import type { MeshPart, PropMesh, Surface } from '../../plan/contract.ts';
import { box, prop, roofPrism, SURFACES, transform } from '../../props/index.ts';
import type { Xz } from './frame.ts';
import { edgesOf, onEdgeBox, punchedWall, rectangle } from './facade.ts';
import { roofDetail, steps } from './house-parts.ts';
import { CITY } from './surfaces.ts';
import { FOUNDATION, flatRoof } from './tower-kit.ts';

const STOREY = 2.9;
const PLINTH = 0.5;

type HouseSpec = {
  id: string;
  size: Xz;
  storeys: number;
  wall: Surface;
  roof?: { surface: Surface; hip: number };
  garage?: boolean;
  porch?: boolean;
  seed: number;
};

/** A house, its footprint's half extents and the footprint centre's shift along X. */
export type House = { prop: PropMesh; half: Xz; shift: number };

function body([w, d]: Xz, storeys: number, wall: Surface, seed: number): MeshPart[] {
  const edges = edgesOf(rectangle(w, d)),
    front = edges.find((e) => e.out[1] > 0.9)!;
  return [
    transform(box(CITY.renderGrey, [w + 0.4, FOUNDATION + PLINTH, d + 0.4]), {
      at: [0, -FOUNDATION, 0],
    }),
    transform(box(wall, [w, storeys * STOREY, d]), { at: [0, PLINTH, 0] }),
    ...edges.flatMap((e, i) =>
      punchedWall(e, PLINTH, storeys, {
        window: 1.2,
        floor: STOREY,
        bay: 3.2,
        lit: 0.25,
        seed: seed + i,
      }),
    ),
    onEdgeBox(SURFACES.wood, front, [1.1, 2.2, 0.12], front.length / 2, PLINTH, 0.02),
  ];
}

function house(spec: HouseSpec): House {
  const [w, d] = spec.size,
    top = PLINTH + spec.storeys * STOREY,
    parts = body(spec.size, spec.storeys, spec.wall, spec.seed);
  if (spec.roof)
    parts.push(
      transform(
        roofPrism(spec.roof.surface, w, d, d * 0.42, { overhang: 0.5, hip: spec.roof.hip }),
        {
          at: [0, top, 0],
        },
      ),
      transform(box(CITY.brickStack, [0.8, d * 0.42 + 1.4, 0.8]), { at: [w * 0.3, top, -d * 0.2] }),
      ...(spec.roof.hip ? [] : roofDetail(spec.roof.surface, w, d, d * 0.42, top)),
    );
  if (!spec.porch) parts.push(...steps(d));
  else parts.push(...flatRoof(w, d, CITY.renderGrey).map((p) => transform(p, { at: [0, top, 0] })));
  let width = w;
  if (spec.garage) {
    parts.push(
      transform(box(spec.wall, [6, 3, 7]), { at: [w / 2 + 3, 0, d / 2 - 3.5] }),
      transform(box(CITY.renderGrey, [6.3, 0.3, 7.3]), { at: [w / 2 + 3, 3, d / 2 - 3.5] }),
      transform(box(CITY.frame, [4.6, 2.4, 0.1]), { at: [w / 2 + 3, 0.1, d / 2] }),
    );
    width += 6;
  }
  if (spec.porch)
    parts.push(
      transform(box(SURFACES.wood, [w * 0.6, 0.3, 2.2]), { at: [0, 0.2, d / 2 + 1.1] }),
      transform(box(spec.roof?.surface ?? CITY.renderGrey, [w * 0.6, 0.15, 2.4]), {
        at: [0, 2.9, d / 2 + 1.2],
      }),
      ...[-1, 1].map((s) =>
        transform(box(CITY.frame, [0.15, 2.6, 0.15]), { at: [s * w * 0.28, 0.3, d / 2 + 2.1] }),
      ),
    );
  return {
    prop: prop(spec.id, parts),
    half: [width / 2 + 0.6, d / 2 + (spec.porch ? 1.6 : 0) + 0.6],
    shift: spec.garage ? 3 : 0,
  };
}

/** Six houses; the garage one is wider, its footprint shifted toward +X. */
export const houses = (seed: number): House[] => [
  house({
    id: 'city/house-gable',
    size: [10, 8],
    storeys: 2,
    wall: CITY.siding,
    roof: { surface: SURFACES.roofTile, hip: 0 },
    seed,
  }),
  house({
    id: 'city/house-bungalow',
    size: [12, 9],
    storeys: 1,
    wall: CITY.render,
    roof: { surface: SURFACES.slate, hip: 3 },
    garage: true,
    seed: seed + 10,
  }),
  house({
    id: 'city/house-porch',
    size: [9, 9],
    storeys: 2,
    wall: CITY.sidingBlue,
    roof: { surface: SURFACES.slate, hip: 0 },
    porch: true,
    seed: seed + 20,
  }),
  house({
    id: 'city/house-modern',
    size: [13, 10],
    storeys: 2,
    wall: SURFACES.whitePaint,
    seed: seed + 30,
  }),
  house({
    id: 'city/house-duplex',
    size: [14, 9],
    storeys: 2,
    wall: CITY.render,
    roof: { surface: SURFACES.roofTile, hip: 0 },
    seed: seed + 40,
  }),
  house({
    id: 'city/house-cottage',
    size: [8, 7],
    storeys: 1,
    wall: SURFACES.brick,
    roof: { surface: SURFACES.slate, hip: 0 },
    porch: true,
    seed: seed + 50,
  }),
];
