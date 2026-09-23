/**
 * The oasis town's public places, real size, fronts facing +Z: the domed hall (`hall.ts`),
 * market stalls under striped awnings, the raised stone pool, a well and a lantern post. Lamps
 * are declared on the props that carry them.
 */
import type { MeshPart, PropMesh } from '../../plan/contract.ts';
import {
  between,
  blob,
  box,
  cylinder,
  extrude,
  lathe,
  plane,
  prop,
  sheet,
  SURFACES,
  transform,
  tube,
  type PropLamp,
} from '../../props/index.ts';
import { PLINTH } from './houses.ts';
import { DESERT } from './palette.ts';
import { domedHall } from './hall.ts';

/** A market stall 3 × 2.4 m: four posts, a counter, a sagging striped awning, goods. */
function stall(id: string, seed: number): PropMesh {
  const parts: MeshPart[] = [
    ...[-1.4, 1.4].flatMap((x) =>
      [-1.1, 1.1].map((z) =>
        transform(cylinder(DESERT.palmWood, 0.05, 2.6, { segments: 6 }), { at: [x, 0, z] }),
      ),
    ),
    transform(box(DESERT.palmWood, [2.8, 0.9, 0.8]), { at: [0, 0, 0.7] }),
  ];
  // Six stripes of an awning sagging 15 cm between its front and back rails.
  for (let s = 0; s < 6; s++)
    parts.push(
      sheet(s % 2 ? DESERT.awningStripe : DESERT.awningRed, 2, 8, (u, v) => {
        const z = (v - 0.5) * 2.8;
        return [-1.6 + ((s + u) * 3.2) / 6, 2.6 - 0.15 * Math.cos((Math.PI * z) / 2.8), -z];
      }),
    );
  for (let g = 0; g < 7; g++)
    parts.push(
      transform(
        blob(g % 2 ? DESERT.ochre : DESERT.succulent, [0.14, 0.14, 0.14], seed + g, { detail: 2 }),
        { at: [-1.1 + g * 0.37, 1.02, 0.6 + between(seed, g, -0.15, 0.15)] },
      ),
    );
  parts.push(transform(box(DESERT.palmWood, [0.9, 0.5, 0.6]), { at: [1, 0, -0.6] }));
  return prop(id, parts);
}

/** The raised pool, 30 × 20 m: a stone kerb 0.6 m high on its plinth, water 0.15 m below the rim, steps. */
function pool(): PropMesh {
  const outline = Array.from({ length: 28 }, (_, i) => {
    const a = (2 * Math.PI * i) / 28;
    return [15 * Math.cos(a), 10 * Math.sin(a)] as const;
  });
  const inner = outline.map(([x, z]) => [x * 0.94, z * 0.91] as const);
  const kerb = outline.map((p, i) => {
    const q = outline[(i + 1) % outline.length],
      a = inner[i],
      b = inner[(i + 1) % inner.length];
    return extrude(DESERT.mudBrick, [p, q, b, a], 0.6 + PLINTH, { caps: 'top' });
  });
  return prop('desert/pool', [
    ...kerb.map((k) => transform(k, { at: [0, -PLINTH, 0] })),
    transform(extrude(DESERT.water, inner, 0.45 + PLINTH, { caps: 'top' }), {
      at: [0, -PLINTH, 0],
    }),
    ...[0, 1, 2].map((k) =>
      transform(box(DESERT.mudPlaster, [3, 0.2, 0.5]), { at: [0, 0.2 * k, 10.2 + 0.5 * (2 - k)] }),
    ),
    transform(plane(DESERT.tileBlue, 3, 0.4), { at: [0, 0.62, -9.4] }),
  ]);
}

/** A well: round stone wall, two posts, a beam, a bucket on its rope. */
const well = (): PropMesh =>
  prop('desert/well', [
    cylinder(DESERT.mudBrick, 1, 0.9, { segments: 20 }),
    transform(cylinder(SURFACES.darkMetal, 0.85, 0.02, { segments: 20 }), { at: [0, 0.88, 0] }),
    ...[-1, 1].map((s) =>
      transform(box(DESERT.palmWood, [0.15, 2.4, 0.15]), { at: [s * 0.95, 0, 0] }),
    ),
    transform(cylinder(DESERT.palmWood, 0.08, 2.2, { segments: 8 }), {
      at: [-1.1, 2.2, 0],
      roll: -Math.PI / 2,
    }),
    tube(
      DESERT.dryBrush,
      [
        [0, 2.2, 0],
        [0, 1.4, 0],
      ],
      0.01,
      { segments: 3 },
    ),
    transform(cylinder(DESERT.palmWood, 0.15, 0.25, { top: 0.18, segments: 10 }), {
      at: [0, 1.15, 0],
    }),
  ]);

/** A 3 m timber post with an iron bracket and a glowing lantern. */
const lanternPost = (): PropMesh =>
  prop('desert/lantern-post', [
    box(DESERT.palmWood, [0.16, 3, 0.16]),
    transform(box(SURFACES.darkMetal, [0.6, 0.05, 0.05]), { at: [0.3, 2.8, 0] }),
    transform(box(DESERT.lantern, [0.22, 0.32, 0.22]), { at: [0.55, 2.42, 0] }),
    transform(
      lathe(
        SURFACES.darkMetal,
        [
          [0.16, 0],
          [0, 0.14],
        ],
        { segments: 6 },
      ),
      { at: [0.55, 2.74, 0] },
    ),
  ]);

/** The lantern's light: a warm point, ~250 lm. */
export const LANTERN_LAMPS: readonly PropLamp[] = [
  {
    id: 'lantern',
    type: 'point',
    offset: [0.55, 2.55, 0],
    color: [1, 0.62, 0.3],
    intensity: 20,
    range: 12,
    night: true,
  },
];

/** The town's public props. */
export const townProps = (seed: number): PropMesh[] => [
  domedHall(),
  stall('desert/stall-spice', seed),
  stall('desert/stall-fruit', seed + 9),
  pool(),
  well(),
  lanternPost(),
];
