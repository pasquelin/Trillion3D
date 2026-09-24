/**
 * A beach café on the promenade: a glazed single-storey pavilion under a flat roof with a
 * parapet, a striped awning over the terrace, a name board, and a timber terrace in front with
 * tables, chairs and parasols. 14 m wide, the terrace toward +Z (the sea); lamps under the
 * awning light the terrace at night.
 */
import type { MeshPart, PropMesh, Surface } from '../../../plan/contract.ts';
import {
  box,
  roundedBox,
  cylinder,
  prop,
  quads,
  SURFACES,
  transform,
  type PropLamp,
} from '../../../props/index.ts';
import { COAST } from '../surfaces.ts';
import { canopy } from './beach.ts';
import { PLINTH } from './houses.ts';

const WIDTH = 14,
  HALL = 7,
  TERRACE = 6,
  HEIGHT = 3.6;

/** The terrace's lamps, warm points under the awning. */
export const CAFE_LAMPS: readonly PropLamp[] = [-4.5, 0, 4.5].map((x, i) => ({
  id: `terrace-${i}`,
  type: 'point',
  offset: [x, 3, HALL / 2 + 1.2],
  color: [1, 0.78, 0.5],
  intensity: 60,
  range: 10,
  night: true,
}));

/** A round table with four chairs, centred at (x, z) on the terrace floor at `y`. */
function tableSet(x: number, z: number, y: number): MeshPart[] {
  const parts = [
    transform(cylinder(SURFACES.darkMetal, 0.04, 0.72, { segments: 6 }), { at: [x, y, z] }),
    transform(cylinder(COAST.whitewash, 0.4, 0.04, { segments: 16 }), { at: [x, y + 0.72, z] }),
  ];
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2 + 0.4,
      cx = x + Math.cos(a) * 0.7,
      cz = z + Math.sin(a) * 0.7,
      chair = [
        transform(box(SURFACES.wood, [0.42, 0.04, 0.42]), { at: [0, 0.44, 0] }),
        transform(roundedBox(SURFACES.wood, [0.42, 0.45, 0.04], 0.015, 1), { at: [0, 0.48, 0.2] }),
        ...[-0.18, 0.18].flatMap((dx) =>
          [-0.18, 0.18].map((dz) =>
            transform(box(SURFACES.darkMetal, [0.03, 0.44, 0.03]), { at: [dx, 0, dz] }),
          ),
        ),
      ];
    parts.push(...chair.map((p) => transform(p, { at: [cx, y, cz], yaw: -a + Math.PI / 2 })));
  }
  return parts;
}

/** The awning: a sloped striped sheet on two posts, with a scalloped valance. */
function awning(a: Surface, b: Surface): MeshPart[] {
  const stripes = 14,
    parts: MeshPart[] = [];
  for (let i = 0; i < stripes; i++) {
    const x0 = -WIDTH / 2 + (i / stripes) * WIDTH,
      x1 = x0 + WIDTH / stripes,
      cloth = i % 2 ? a : b,
      [back, front] = [HALL / 2, HALL / 2 + 3.2];
    parts.push(
      quads(cloth, [
        [
          [x0, HEIGHT - 0.4, back],
          [x0, 2.7, front],
          [x1, 2.7, front],
          [x1, HEIGHT - 0.4, back],
        ],
        [
          [x0, 2.7, front],
          [x0, 2.4, front],
          [x1, 2.4, front],
          [x1, 2.7, front],
        ],
      ]),
    );
  }
  for (const x of [-WIDTH / 2 + 0.2, WIDTH / 2 - 0.2])
    parts.push(
      transform(cylinder(SURFACES.darkMetal, 0.05, 2.7, { segments: 8 }), {
        at: [x, 0, HALL / 2 + 3.2],
      }),
    );
  return parts;
}

function beachCafe(id: string, wall: Surface, a: Surface, b: Surface): PropMesh {
  const parts: MeshPart[] = [
    transform(roundedBox(COAST.granite, [WIDTH + 0.4, PLINTH + 0.4, HALL + 0.4], 0.06, 2), {
      at: [0, -PLINTH, 0],
    }),
    transform(roundedBox(wall, [WIDTH, HEIGHT - 0.4, HALL], 0.1, 3), { at: [0, 0.4, 0] }),
    transform(roundedBox(wall, [WIDTH + 0.3, 0.6, HALL + 0.3], 0.08, 2), { at: [0, HEIGHT, 0] }),
    transform(box(COAST.quayStone, [WIDTH - 0.6, 0.1, HALL - 0.6]), { at: [0, HEIGHT + 0.4, 0] }),
    transform(box(COAST.seaBlue, [5, 0.8, 0.1]), { at: [0, HEIGHT - 0.2, HALL / 2 + 0.18] }),
    transform(box(SURFACES.emissiveWindow, [4.6, 0.4, 0.04]), { at: [0, HEIGHT, HALL / 2 + 0.24] }),
    transform(box(COAST.deckWood, [WIDTH, 0.25, TERRACE]), {
      at: [0, 0.15, HALL / 2 + TERRACE / 2],
    }),
    ...awning(a, b),
  ];
  const bays = 6;
  for (let i = 0; i < bays; i++) {
    const x = -WIDTH / 2 + ((i + 0.5) / bays) * WIDTH;
    parts.push(
      transform(box(SURFACES.glass, [WIDTH / bays - 0.2, 2.4, 0.05]), {
        at: [x, 0.5, HALL / 2 + 0.02],
      }),
      transform(box(COAST.whitewash, [0.12, 2.6, 0.14]), {
        at: [x - WIDTH / bays / 2, 0.4, HALL / 2 + 0.04],
      }),
    );
  }
  parts.push(
    transform(box(COAST.whitewash, [WIDTH, 0.12, 0.14]), { at: [0, 2.9, HALL / 2 + 0.04] }),
  );
  for (let i = 0; i < 3; i++) {
    const x = -4.5 + i * 4.5,
      z = HALL / 2 + 4.6;
    parts.push(...tableSet(x - 1.2, z, 0.4), ...tableSet(x + 1.2, z - 1.5, 0.4));
    parts.push(
      transform(cylinder(SURFACES.wood, 0.03, 2.4, { segments: 6 }), {
        at: [x + 0.2, 0.4, z + 0.3],
      }),
    );
    parts.push(
      ...canopy(a, b, 1.4, 2.8, 0.5).map((p) => transform(p, { at: [x + 0.2, 0, z + 0.3] })),
    );
  }
  return prop(id, parts);
}

export const cafeProps = (): PropMesh[] => [
  beachCafe('coast-cafe-blue', COAST.whitewash, COAST.canvasBlue, COAST.canvasWhite),
  beachCafe('coast-cafe-red', COAST.ochre, COAST.canvasRed, COAST.canvasWhite),
];
