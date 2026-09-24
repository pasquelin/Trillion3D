/**
 * The highway's roadside at real size, fronts facing +Z (the road side): the fuel canopies
 * (`canopy.ts`), the station's shop, a tall lit price sign, the truck stop's diner, a
 * billboard. Lamps live on the props.
 */
import type { MeshPart, PropMesh } from '../../plan/contract.ts';
import { box, cylinder, prop, SURFACES, transform, type PropLamp } from '../../props/index.ts';
import { PLINTH } from './houses.ts';
import { windowIn } from './walls.ts';
import { canopyProps } from './canopy.ts';
import { DESERT } from './palette.ts';

const { steel, glass, darkMetal, whitePaint } = SURFACES;

/** A shop 16 × 10 m: glass front with mullions, a lit fascia, roof units, an ice chest. */
function shop(): PropMesh {
  const parts: MeshPart[] = [
    transform(box(DESERT.mudPlaster, [16, 4.5 + PLINTH, 10]), { at: [0, -PLINTH, 0] }),
    transform(box(DESERT.forecourtRed, [16.4, 0.9, 10.4]), { at: [0, 4.2, 0] }),
    transform(box(DESERT.signLight, [8, 0.6, 0.05]), { at: [0, 4.35, 5.22] }),
    transform(box(glass, [12, 2.8, 0.05]), { at: [0, 0.3, 5.02] }),
    transform(box(whitePaint, [1.4, 0.8, 0.8]), { at: [6.5, 0, 5.6] }),
  ];
  for (let m = 0; m <= 8; m++)
    parts.push(transform(box(darkMetal, [0.1, 2.9, 0.12]), { at: [-6 + m * 1.5, 0.25, 5.06] }));
  parts.push(transform(box(darkMetal, [12.1, 0.12, 0.14]), { at: [0, 3.1, 5.06] }));
  for (const x of [-4, 0, 4]) {
    parts.push(transform(box(steel, [1.8, 1, 1.4]), { at: [x, 4.5, -2] }));
    parts.push(transform(cylinder(darkMetal, 0.5, 0.05, { segments: 16 }), { at: [x, 5.5, -2] }));
  }
  parts.push(
    ...[-5, 5].flatMap((x) =>
      windowIn(x, 1, 1.2, 1.2, -5).map((p) => transform(p, { yaw: Math.PI })),
    ),
  );
  return prop('desert/station-shop', parts);
}

/** A 14 m price sign on two legs: lit panels on both faces, a red crown. */
function priceSign(): PropMesh {
  const parts: MeshPart[] = [
    ...[-1.2, 1.2].map((x) => transform(box(steel, [0.4, 14, 0.4]), { at: [x, 0, 0] })),
    transform(box(DESERT.forecourtRed, [3.6, 2.4, 0.8]), { at: [0, 11.6, 0] }),
  ];
  for (let k = 0; k < 3; k++)
    for (const z of [-0.42, 0.42])
      parts.push(transform(box(DESERT.signLight, [3, 1, 0.04]), { at: [0, 5.2 + k * 2, z] }));
  return prop('desert/price-sign', parts);
}
export const PRICE_SIGN_LAMPS: readonly PropLamp[] = [
  {
    id: 'glow',
    type: 'point',
    offset: [0, 9, 1.2],
    color: [1, 0.86, 0.6],
    intensity: 60,
    range: 20,
    night: true,
  },
];

/** A roadside diner: a long barrel-roofed hall, window band, a neon crown. */
function diner(): PropMesh {
  // A cylinder laid along X, squashed to a 1.6 m rise over the 9 m width.
  const vault = transform(cylinder(DESERT.trailer, 4.5, 22, { segments: 24 }), {
    roll: -Math.PI / 2,
    at: [-11, 3.5, 0],
    scale: [0.35, 1, 1],
  });
  const parts: MeshPart[] = [
    transform(box(DESERT.trailer, [22, 3.5 + PLINTH, 9]), { at: [0, -PLINTH, 0] }),
    vault,
    transform(box(DESERT.neonRed, [10, 0.3, 0.1]), { at: [0, 3.2, 4.56] }),
    transform(box(DESERT.neonRed, [10, 1.1, 0.1]), { at: [0, 4.9, 0] }),
  ];
  for (let i = 0; i < 8; i++) parts.push(...windowIn(-9 + i * 2.6, 1, 1.8, 1.4, 4.5));
  return prop('desert/diner', parts);
}
export const DINER_LAMPS: readonly PropLamp[] = [
  {
    id: 'neon',
    type: 'point',
    offset: [0, 5, 3],
    color: [1, 0.15, 0.08],
    intensity: 80,
    range: 24,
    night: true,
  },
];

/** A 12 × 4 m billboard on two posts, lit by two lamps from its catwalk. */
const billboard = (): PropMesh =>
  prop('desert/billboard', [
    ...[-3, 3].map((x) => transform(box(darkMetal, [0.4, 8, 0.4]), { at: [x, 0, 0] })),
    transform(box(DESERT.awningStripe, [12, 4, 0.2]), { at: [0, 6.5, 0] }),
    transform(box(DESERT.tileBlue, [11, 1.2, 0.05]), { at: [0, 8.4, 0.12] }),
    transform(box(darkMetal, [12, 0.1, 1]), { at: [0, 6.2, 0.6] }),
    ...[-3, 3].map((x) => transform(box(DESERT.signLight, [0.6, 0.2, 0.3]), { at: [x, 6.3, 1.1] })),
  ]);

export const stationProps = (): PropMesh[] => [
  ...canopyProps(),
  shop(),
  priceSign(),
  diner(),
  billboard(),
];
