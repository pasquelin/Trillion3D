/**
 * The oasis town's domed hall, real size, its arcade facing +Z: a square hall under a tiled
 * drum and a ribbed dome, a parapet of merlons, four small corner domes, an arcade of seven
 * arches, and a slender square tower with a balcony and a small dome of its own. A civic
 * building, deliberately generic: no symbol of any faith.
 */
import type { MeshPart, PropMesh, Vec3 } from '../../plan/contract.ts';
import {
  box,
  cylinder,
  lathe,
  prop,
  roundedBox,
  SURFACES,
  transform,
  tube,
  type PropLamp,
} from '../../props/index.ts';
import { PLINTH } from './houses.ts';
import { DESERT } from './palette.ts';
import { archedGate, parapet, windowIn } from './walls.ts';

/** A dome of `radius` on a drum, its base at y = 0: `segments` around, a slight point on top. */
const dome = (radius: number, segments: number, surface = DESERT.domeCopper) =>
  lathe(
    surface,
    Array.from({ length: 25 }, (_, i): readonly [number, number] => {
      const a = (Math.PI / 2) * (i / 24);
      return [i === 24 ? 0 : radius * Math.cos(a), radius * Math.sin(a) * 1.08];
    }),
    { segments },
  );

/** The domed hall: 22 m square, 9 m walls, a 16 m drum and dome, a 28 m tower at a corner. */
export function domedHall(): PropMesh {
  const size = 22,
    h = 9,
    parts: MeshPart[] = [
      transform(box(DESERT.limewash, [size, h + PLINTH, size]), { at: [0, -PLINTH, 0] }),
      transform(box(DESERT.mudPlaster, [size + 0.6, 0.6, size + 0.6]), { at: [0, h, 0] }),
      transform(cylinder(DESERT.limewash, 7.2, 3.4, { segments: 96 }), { at: [0, h + 0.6, 0] }),
      transform(cylinder(DESERT.tileBlue, 7.3, 1.1, { segments: 96 }), { at: [0, h + 2.4, 0] }),
      transform(dome(7.2, 96), { at: [0, h + 4, 0] }),
      ...parapet(size + 0.6, size + 0.6, h + 0.6),
      transform(
        lathe(
          SURFACES.steel,
          [
            [0.25, 0],
            [0.12, 1.2],
            [0.2, 1.4],
            [0, 2.2],
          ],
          { segments: 10 },
        ),
        { at: [0, h + 11.7, 0] },
      ),
    ];
  // The arcade: seven arches along the front, a shaded walk behind.
  for (let i = 0; i < 7; i++)
    parts.push(
      ...archedGate(2.2, 4.4, 0, false).map((p) =>
        transform(p, { at: [-9 + i * 3, 0, size / 2 + 2.2] }),
      ),
    );
  parts.push(transform(box(DESERT.mudPlaster, [size, 0.6, 3]), { at: [0, 4.4, size / 2 + 1.5] }));
  // Windows on three sides, pointed grilles.
  for (const yaw of [Math.PI / 2, Math.PI, -Math.PI / 2])
    for (let i = 0; i < 5; i++)
      parts.push(
        ...windowIn(-8 + i * 4, 4.5, 1.2, 2.8, size / 2).map((p) => transform(p, { yaw })),
      );
  // Four small corner domes.
  for (const [x, z] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ])
    parts.push(
      transform(dome(1.6, 32, DESERT.limewash), {
        at: [(x * size) / 2.6, h + 0.6, (z * size) / 2.6],
      }),
    );
  // Drum windows between ribs of the dome.
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    parts.push(
      transform(roundedBox(SURFACES.glass, [0.7, 1.6, 0.1], 0.3, 3), {
        at: [7.22 * Math.cos(a), h + 0.8, 7.22 * Math.sin(a)],
        yaw: Math.PI / 2 - a,
      }),
    );
    parts.push(
      transform(
        tube(
          DESERT.domeCopper,
          Array.from({ length: 13 }, (_, i): Vec3 => {
            const t = (Math.PI / 2) * (i / 12);
            return [
              7.25 * Math.cos(t) * Math.cos(a),
              h + 4 + 7.25 * 1.08 * Math.sin(t),
              7.25 * Math.cos(t) * Math.sin(a),
            ];
          }),
          0.08,
          { segments: 5 },
        ),
        {},
      ),
    );
  }
  // The tower: square shaft, a balcony, a lantern storey and its dome.
  const tower: Vec3 = [size / 2 - 2, 0, -size / 2 + 2];
  parts.push(
    transform(box(DESERT.limewash, [4, 22 + PLINTH, 4]), { at: [tower[0], -PLINTH, tower[2]] }),
  );
  parts.push(transform(box(DESERT.mudPlaster, [5.2, 0.5, 5.2]), { at: [tower[0], 21, tower[2]] }));
  for (let k = 0; k < 4; k++)
    parts.push(
      transform(box(DESERT.palmWood, [5.2, 0.9, 0.12]), {
        at: [tower[0], 21.5, tower[2]],
        yaw: (k * Math.PI) / 2,
      }),
    );
  parts.push(transform(box(DESERT.limewash, [3, 3.6, 3]), { at: [tower[0], 22, tower[2]] }));
  parts.push(transform(dome(1.7, 32), { at: [tower[0], 25.6, tower[2]] }));
  return prop('desert/domed-hall', parts);
}

/** Lamps along the hall's arcade, lit at night: warm lanterns, ~400 lm each. */
export const HALL_LAMPS: readonly PropLamp[] = [-6, 0, 6].map((x, i) => ({
  id: `arcade-${i}`,
  type: 'point',
  offset: [x, 3.8, 12.4] as Vec3,
  color: [1, 0.7, 0.4],
  intensity: 35,
  range: 14,
  night: true,
}));
