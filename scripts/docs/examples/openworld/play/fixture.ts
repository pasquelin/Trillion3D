import type {
  SimLimits,
  SimWorld,
} from '../../../../../site/examples/kit/openworld/play/protocol.ts';
import type { Road, Vec3 } from '../../../../../site/examples/kit/openworld/play/types.ts';
import {
  decodeCollisionMesh,
  encodeCollisionMesh,
  type ColliderInstance,
} from '../../../../../site/examples/kit/openworld/play/collision.ts';
import { collisionMesh } from '../build/collision.ts';
import { box, prop, SURFACES } from '../props/index.ts';
import { churchSquare } from '../regions/countryside/church.ts';

/**
 * A small world for the play layer's tests: 8 × 8 km of tiles 1 km wide, 32 samples a side, a
 * gentle slope rising east, a square of streets crossed by an avenue that meets a lane at a
 * junction, a highway, a town, a runway, and spawn and teleport markers. Heights come from one function, as the plan's do.
 */
export const SAMPLES = 32;

export const slope = (x: number, _z: number) => 20 + x * 0.01;

const line = (
  id: string,
  kind: Road['class'],
  width: number,
  points: [number, number][],
): Road => ({
  id,
  class: kind,
  width,
  points: points.map(([x, z]): Vec3 => [x, slope(x, z), z]),
});

export const ROADS: Road[] = [
  line('north', 'street', 8, [
    [-300, -300],
    [0, -300],
    [300, -300],
  ]),
  line('east', 'street', 8, [
    [300, -300],
    [300, 0],
    [300, 300],
  ]),
  line('south', 'street', 8, [
    [300, 300],
    [0, 300],
    [-300, 300],
  ]),
  line('west', 'street', 8, [
    [-300, 300],
    [-300, 0],
    [-300, -300],
  ]),
  line('avenue', 'avenue', 12, [
    [0, -300],
    [0, 300],
  ]),
  line('lane', 'street', 6, [
    [0, 300],
    [0, 900],
  ]),
  line('highway', 'highway', 14, [
    [-3000, 0],
    [-300, 0],
  ]),
  line('runway', 'runway', 45, [
    [1000, 2000],
    [3000, 2000],
  ]),
];

export function fixtureWorld(): SimWorld {
  return {
    seed: 332,
    size: 8000,
    tile: 1000,
    heightSamples: SAMPLES,
    roads: ROADS,
    settlements: [
      { id: 'town', kind: 'town', region: 'countryside', centre: [0, slope(0, 0), 0], radius: 600 },
    ],
    markers: [
      { kind: 'teleport', name: 'green', position: [40, slope(40, 0), 0], yaw: 0 },
      { kind: 'spawn', vehicle: 'car', name: 'car park', position: [44, slope(44, 0), 0], yaw: 0 },
      {
        kind: 'spawn',
        vehicle: 'plane',
        name: 'apron',
        position: [1100, slope(1100, 2000), 2000],
        yaw: -Math.PI / 2,
      },
      {
        kind: 'spawn',
        vehicle: 'car',
        name: 'highway',
        position: [-2000, slope(-2000, 0), 0],
        yaw: -Math.PI / 2,
      },
      { kind: 'teleport', name: 'roadside', position: [-2000, slope(-2000, 3), 3], yaw: 0 },
      { kind: 'teleport', name: 'far', position: [3500, slope(3500, 3500), 3500], yaw: 0 },
    ],
    movers: [
      {
        kind: 'spin',
        name: 'turbine',
        model: 'rotor',
        position: [0, 80, -2000],
        axis: [0, 0, 1],
        rpm: 12,
      },
      {
        kind: 'path',
        name: 'ferry',
        model: 'boat',
        points: [
          [-3000, 0, 3000],
          [-1000, 0, 3000],
        ],
        speed: 8,
        loop: false,
      },
    ],
    car: {
      wheels: [
        { position: [-0.8, -0.1, -1.3], radius: 0.35, width: 0.25, steer: true },
        { position: [0.8, -0.1, -1.3], radius: 0.35, width: 0.25, steer: true },
        { position: [-0.8, -0.1, 1.3], radius: 0.35, width: 0.25, steer: false },
        { position: [0.8, -0.1, 1.3], radius: 0.35, width: 0.25, steer: false },
      ],
    },
  };
}

export const LIMITS: SimLimits = { radius: 1500, traffic: 24, pedestrians: 40 };

/** The heights of tile (tx, tz) of the fixture, as `heights/<tx>_<tz>.bin` would hold them. */
export function tileHeights(tx: number, tz: number, size = 8000, tile = 1000): Float32Array {
  const heights = new Float32Array((SAMPLES + 1) ** 2);
  const [minX, minZ] = [tx * tile - size / 2, tz * tile - size / 2];
  for (let j = 0; j <= SAMPLES; j++)
    for (let i = 0; i <= SAMPLES; i++)
      heights[j * (SAMPLES + 1) + i] = slope(
        minX + (i * tile) / SAMPLES,
        minZ + (j * tile) / SAMPLES,
      );
  return heights;
}

/** The props the fixture places, as the generator writes them: a unit block on its base, and a
 * village's church square. */
const SOLIDS = new Map(
  [prop('block', [box(SURFACES.concrete, [1, 1, 1])]), churchSquare()[0]].map((mesh) => [
    mesh.id,
    encodeCollisionMesh(collisionMesh(mesh)!),
  ]),
);

/** The colliders the worker would fetch: `tiles` by key `<tx>_<tz>`, each mesh read back. */
export const solidSource = (tiles: Record<string, readonly ColliderInstance[]>) => ({
  tile: async (tx: number, tz: number) => tiles[`${tx}_${tz}`] ?? [],
  mesh: async (id: string) => decodeCollisionMesh(SOLIDS.get(id)!.slice().buffer),
});
