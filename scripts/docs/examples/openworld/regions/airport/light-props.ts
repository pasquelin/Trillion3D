/**
 * Aeronautical ground lights at real size: elevated edge lights on frangible stakes (white on
 * runways, blue on taxiways), flush inset lights, the threshold bar (green toward the approach,
 * red toward the runway), approach crossbars on masts, a PAPI unit, and the apron floodlight
 * mast whose lamps light the stands at night.
 */
import type { PropMesh, Surface } from '../../plan/contract.ts';
import {
  box,
  cylinder,
  prop,
  SURFACES,
  transform,
  tube,
  type PropLamp,
} from '../../props/index.ts';
import { LIGHTS } from './palette.ts';
import { repeat } from './parts.ts';

const { steel, darkMetal, glass } = SURFACES;

/** A 35 cm frangible stake carrying a lens that glows `lens`. */
const stake = (id: string, lens: Surface) =>
  prop(id, [
    cylinder(darkMetal, 0.12, 0.05, { segments: 10, caps: true }),
    cylinder(steel, 0.035, 0.28, { segments: 8 }),
    transform(cylinder(lens, 0.08, 0.1, { top: 0.06, segments: 12, caps: true }), {
      at: [0, 0.28, 0],
    }),
  ]);

/** A flush light set in the pavement: a steel rim and a lens a few millimetres proud. */
const insetUnit = (lens: Surface) => [
  cylinder(steel, 0.2, 0.015, { segments: 12, caps: true }),
  transform(box(lens, [0.16, 0.02, 0.06]), { at: [0, 0.005, 0.06] }),
];

/** Threshold bar across 45 m: each unit shows green toward −Z (approach), red toward +Z. */
function thresholdBar(): PropMesh {
  const units = Array.from({ length: 15 }, (_, i) => -21 + i * 3);
  return prop('airport/light-threshold', [
    ...units.flatMap((x) => [
      transform(cylinder(steel, 0.2, 0.015, { segments: 12, caps: true }), { at: [x, 0, 0] }),
      transform(box(LIGHTS.green, [0.16, 0.02, 0.05]), { at: [x, 0.005, -0.07] }),
      transform(box(LIGHTS.red, [0.16, 0.02, 0.05]), { at: [x, 0.005, 0.07] }),
    ]),
  ]);
}

/** An approach crossbar: a 4 m mast, a 16 m bar, five lamp housings with lenses toward −Z. */
function approachBar(): PropMesh {
  const lamp = [
    box(darkMetal, [0.35, 0.35, 0.45]),
    transform(cylinder(LIGHTS.white, 0.14, 0.06, { segments: 12, caps: true }), {
      at: [0, 0.175, -0.22],
      pitch: -Math.PI / 2,
    }),
  ];
  return prop('airport/light-approach', [
    cylinder(SURFACES.whitePaint, 0.12, 4, { top: 0.08, segments: 10 }),
    tube(
      SURFACES.whitePaint,
      [
        [-8, 4, 0],
        [8, 4, 0],
      ],
      0.06,
      { segments: 8 },
    ),
    ...[-7, -3.5, 0, 3.5, 7].flatMap((x) =>
      lamp.map((part) => transform(part, { at: [x, 4.05, 0] })),
    ),
  ]);
}

/** A PAPI unit: a box on four legs, its lens split white over red, facing −Z. */
const papi = () =>
  prop('airport/papi', [
    ...repeat(cylinder(steel, 0.04, 0.5, { segments: 6 }), 2, [-0.5, 0, -0.3], [1, 0, 0]),
    ...repeat(cylinder(steel, 0.04, 0.5, { segments: 6 }), 2, [-0.5, 0, 0.3], [1, 0, 0]),
    transform(box(SURFACES.whitePaint, [1.4, 0.7, 1]), { at: [0, 0.5, 0] }),
    transform(box(LIGHTS.white, [0.5, 0.12, 0.02]), { at: [0, 0.95, -0.51] }),
    transform(box(LIGHTS.red, [0.5, 0.12, 0.02]), { at: [0, 0.8, -0.51] }),
    transform(box(glass, [0.6, 0.34, 0.01]), { at: [0, 0.73, -0.52] }),
  ]);

/** Six 2 kW floods on a 30 m mast, aimed down and outward over the stands. */
export const FLOOD_LIGHTS: readonly PropLamp[] = [-1, 0, 1].flatMap((i) =>
  [-1, 1].map((side): PropLamp => ({
    id: `flood-${i + 1}-${side > 0 ? 'b' : 'a'}`,
    type: 'spot',
    offset: [i * 1.4, 29.5, side * 0.8],
    direction: [i * 0.3, -1, side * 0.6],
    cone: 0.6,
    color: [1, 0.9, 0.75],
    // ≈ 180 000 lm into a 0.6 rad half cone (≈ 1.1 sr) ≈ 160 000 cd.
    intensity: 160000,
    range: 140,
    night: true,
  })),
);

function floodMast(): PropMesh {
  const heads = FLOOD_LIGHTS.flatMap(({ offset: [x, y, z] }) => [
    transform(box(darkMetal, [1.1, 0.5, 0.9]), { at: [x, y, z] }),
    transform(box(SURFACES.emissiveLamp, [0.9, 0.02, 0.7]), { at: [x, y - 0.01, z] }),
  ]);
  return prop('airport/flood-mast', [
    transform(box(SURFACES.concrete, [1.6, 1.4, 1.6]), { at: [0, -0.9, 0] }),
    cylinder(SURFACES.steel, 0.45, 29, { top: 0.22, segments: 16 }),
    transform(box(SURFACES.steel, [4.4, 0.25, 2.2]), { at: [0, 29.9, 0] }),
    ...heads,
  ]);
}

export const lightProps = (): PropMesh[] => [
  stake('airport/light-edge', LIGHTS.white),
  stake('airport/light-taxi', LIGHTS.blue),
  prop('airport/light-inset', insetUnit(LIGHTS.white)),
  thresholdBar(),
  approachBar(),
  papi(),
  floodMast(),
];
