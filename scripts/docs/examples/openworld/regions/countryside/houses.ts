/**
 * Village houses, real size, front door toward +Z, floor at y = 0 on a stone plinth: plastered,
 * stone, brick, timber-framed and a thatched cottage. Each carries its porch lamp.
 */
import type { MeshPart, PropMesh, Surface } from '../../plan/contract.ts';
import { box, prop, SURFACES, transform, type PropLamp } from '../../props/index.ts';
import { LAND } from './ground.ts';
import { chimney, door, facade, plinth, walls } from './parts.ts';
import { COVERINGS, roof as roofOver, type Covering } from './roofs.ts';

const { plaster, brick, wood, darkMetal } = SURFACES;
/** Warm white of a filament-like lamp, linear RGB. */
export const WARM: readonly [number, number, number] = [1, 0.78, 0.5];

/** A porch lamp above a door at (x, z): a glowing box on a bracket, and its light. */
function porch(x: number, z: number, y = 2.75): [MeshPart[], PropLamp] {
  return [
    [
      transform(box(darkMetal, [0.08, 0.08, 0.3]), { at: [x, y + 0.25, z + 0.15] }),
      transform(box(LAND.porchLamp, [0.18, 0.26, 0.18]), { at: [x, y, z + 0.3] }),
    ],
    // About 800 lm from a bulb all round: 800 / 4π ≈ 64 cd; it lights a doorstep and a path.
    {
      id: 'porch',
      type: 'point',
      offset: [x, y, z + 0.3],
      color: WARM,
      intensity: 64,
      range: 10,
      night: true,
    },
  ];
}

export type HouseSpec = {
  id: string;
  width: number;
  depth: number;
  floors: number;
  wall: Surface;
  roof: Covering;
  shutters: Surface;
  windows: readonly [number, number];
  hip?: number;
  /** Dark timber framing over the walls: posts between the windows, rails at every floor. */
  beams?: boolean;
  /** Roof rise as a share of the depth. */
  pitch?: number;
};

/** Timber framing on the four walls of a body, posts at the window slots' edges. */
function framing(
  width: number,
  depth: number,
  height: number,
  [front, side]: readonly [number, number],
) {
  const wall = (span: number, slots: number, at: number) => [
    ...Array.from({ length: slots + 1 }, (_, i) =>
      transform(box(wood, [0.18, height, 0.08]), { at: [-span / 2 + (span * i) / slots, 0, at] }),
    ),
    ...[0, height / 2, height - 0.2].map((y) =>
      transform(box(wood, [span, 0.2, 0.08]), { at: [0, y, at] }),
    ),
  ];
  return [
    ...wall(width, front, depth / 2 + 0.04),
    ...wall(width, front, depth / 2 + 0.04).map((p) => transform(p, { yaw: Math.PI })),
    ...[Math.PI / 2, -Math.PI / 2].flatMap((yaw) =>
      wall(depth, side, width / 2 + 0.04).map((p) => transform(p, { yaw })),
    ),
  ].map((p) => transform(p, { at: [0, 0.3, 0] }));
}

/** A house: plinth, walls, framed windows with shutters, a door with its lamp, roof, chimney. */
export function house(spec: HouseSpec): [PropMesh, PropLamp[]] {
  const { width, depth, floors, wall, roof, shutters, windows, hip = 0, pitch = 0.42 } = spec,
    height = floors * 2.9 + 0.3,
    doorSlot = Math.floor(windows[0] / 2),
    doorX = -(width - 1) / 2 + ((width - 1) * (doorSlot + 0.5)) / windows[0],
    [lamp, light] = porch(doorX + 0.9, depth / 2);
  const parts = [
    plinth(width, depth),
    transform(walls(wall, width, depth, height), { at: [0, 0.3, 0] }),
    ...facade(width, depth, floors, windows, shutters, doorSlot).map((p) =>
      transform(p, { at: [0, 0.3, 0] }),
    ),
    ...door(doorX, depth / 2),
    ...lamp,
    ...(spec.beams ? framing(width, depth, height, windows) : []),
    ...roofOver(width, depth, height + 0.3, depth * pitch, roof, wall, hip),
    ...chimney(width * 0.28, -depth * 0.15, height, depth * pitch + 0.8),
  ];
  return [prop(spec.id, parts), [light]];
}

export const HOUSES: readonly HouseSpec[] = [
  {
    id: 'countryside/house-plaster',
    width: 10,
    depth: 8,
    floors: 2,
    wall: plaster,
    roof: COVERINGS.clay,
    shutters: LAND.shutterGreen,
    windows: [3, 2],
  },
  {
    id: 'countryside/house-stone',
    width: 8.5,
    depth: 7,
    floors: 1,
    wall: LAND.stone,
    roof: COVERINGS.slate,
    shutters: LAND.shutterBlue,
    windows: [3, 1],
  },
  {
    id: 'countryside/house-brick',
    width: 12,
    depth: 7.5,
    floors: 2,
    wall: brick,
    roof: COVERINGS.clay,
    shutters: LAND.shutterBlue,
    windows: [4, 2],
    hip: 2,
  },
  {
    id: 'countryside/house-timber',
    width: 9,
    depth: 7.5,
    floors: 2,
    wall: plaster,
    roof: COVERINGS.clay,
    shutters: LAND.shutterGreen,
    windows: [3, 2],
    beams: true,
    pitch: 0.55,
  },
  {
    id: 'countryside/cottage',
    width: 7.5,
    depth: 6,
    floors: 1,
    wall: LAND.stone,
    roof: COVERINGS.thatch,
    shutters: LAND.shutterBlue,
    windows: [2, 1],
    pitch: 0.7,
  },
];
