/**
 * Timber and stone at the water's edge: a pier bay (deck on pile bents, railings, and on one
 * variant a pair of cast-iron lamps) and the pier head. Origins sit on the walking surface at
 * the bay's centre; the pier runs along +Z (out to sea). Piles reach `PIER.piles` below it.
 */
import type { MeshPart, PropMesh } from '../../../plan/contract.ts';
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
} from '../../../props/index.ts';
import { COAST } from '../surfaces.ts';
import { lampAt, lampStandard } from './lamp-standard.ts';

export const PIER = {
  bay: 12,
  width: 6,
  deck: 4,
  piles: 14,
  head: 24,
  quay: 10,
  quayDepth: 6,
} as const;

export const PIER_LAMPS: readonly PropLamp[] = [
  lampAt('west', -PIER.width / 2 + 0.2, 0),
  lampAt('east', PIER.width / 2 - 0.2, 0),
];

/** A timber railing along Z at x: a post every 2 m, two rails. */
function railing(length: number, x: number): MeshPart[] {
  const posts = Math.round(length / 2),
    parts: MeshPart[] = [];
  for (let i = 0; i <= posts; i++)
    parts.push(
      transform(box(COAST.weatheredWood, [0.12, 1.1, 0.12]), {
        at: [x, 0, -length / 2 + (i / posts) * length],
      }),
    );
  for (const y of [0.55, 1.05])
    parts.push(transform(box(COAST.weatheredWood, [0.08, 0.1, length]), { at: [x, y, 0] }));
  return parts;
}

/** A deck of planks across X, `length` along Z, on stringers; railings on the given sides. */
function deck(width: number, length: number, rails: readonly number[]): MeshPart[] {
  const parts: MeshPart[] = [],
    planks = Math.round(length / 0.3);
  for (let i = 0; i < planks; i++)
    parts.push(
      transform(roundedBox(COAST.deckWood, [width, 0.08, 0.27], 0.02, 1), {
        at: [0, -0.08, -length / 2 + (i + 0.5) * (length / planks)],
      }),
    );
  for (const x of [-width / 2 + 0.3, 0, width / 2 - 0.3])
    parts.push(transform(box(COAST.weatheredWood, [0.25, 0.35, length]), { at: [x, -0.43, 0] }));
  for (const side of rails) parts.push(...railing(length, (side * width) / 2 - side * 0.1));
  return parts;
}

/** A bent of piles across X at z, braced diagonally, reaching `PIER.piles` down. */
function bent(width: number, z: number): MeshPart[] {
  const xs = [-width / 2 + 0.3, 0, width / 2 - 0.3];
  return [
    ...xs.map((x) =>
      transform(cylinder(COAST.weatheredWood, 0.2, PIER.piles, { segments: 10 }), {
        at: [x, -PIER.piles, z],
      }),
    ),
    transform(box(COAST.weatheredWood, [width, 0.3, 0.3]), { at: [0, -0.9, z] }),
    tube(
      COAST.weatheredWood,
      [
        [xs[0], -1, z],
        [xs[1], -5, z],
      ],
      0.08,
      { segments: 5 },
    ),
    tube(
      COAST.weatheredWood,
      [
        [xs[2], -1, z],
        [xs[1], -5, z],
      ],
      0.08,
      { segments: 5 },
    ),
  ];
}

const pierBay = (id: string, lamps: boolean): PropMesh =>
  prop(id, [
    ...deck(PIER.width, PIER.bay, [-1, 1]),
    ...bent(PIER.width, -PIER.bay / 2 + 0.3),
    ...bent(PIER.width, PIER.bay / 2 - 0.3),
    ...(lamps ? PIER_LAMPS.flatMap(({ offset: [x, , z] }) => lampStandard(x, z)) : []),
  ]);

/** The pier head: a square platform, a shelter with benches, a lamp at each seaward corner. */
export const PIER_HEAD_LAMPS: readonly PropLamp[] = [
  lampAt('north-west', -PIER.head / 2 + 0.4, PIER.head / 2 - 0.4),
  lampAt('north-east', PIER.head / 2 - 0.4, PIER.head / 2 - 0.4),
];

function pierHead(): PropMesh {
  const h = PIER.head,
    parts = [...deck(h, h, [-1, 1]), ...[-1, 0, 1].flatMap((k) => bent(h, (k * h) / 2.4))];
  parts.push(
    ...railing(h, 0).map((p) => transform(p, { at: [0, 0, h / 2 - 0.1], yaw: Math.PI / 2 })),
  );
  for (const [x, , z] of PIER_HEAD_LAMPS.map((lamp) => lamp.offset))
    parts.push(...lampStandard(x, z));
  for (const [x, z] of [
    [-3, -3],
    [3, -3],
    [-3, 3],
    [3, 3],
  ])
    parts.push(transform(cylinder(COAST.whitewash, 0.1, 3, { segments: 8 }), { at: [x, 0, z] }));
  parts.push(
    transform(
      lathe(
        COAST.seaBlue,
        [
          [5.4, 0],
          [3.6, 1.2],
          [0.6, 2.1],
          [0, 2.2],
        ],
        { segments: 8, shading: 'flat' },
      ),
      { at: [0, 3, 0] },
    ),
    transform(box(SURFACES.wood, [5, 0.08, 0.5]), { at: [0, 0.45, -2.6] }),
    transform(box(SURFACES.wood, [5, 0.08, 0.5]), { at: [0, 0.45, 2.6] }),
  );
  return prop('coast-pier-head', parts);
}

export const pierProps = (): PropMesh[] => [
  pierBay('coast-pier-bay', false),
  pierBay('coast-pier-bay-lamps', true),
  pierHead(),
];
