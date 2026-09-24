/**
 * The airfield's furniture: a 25 m run of security fence, the paved slab every apron and car
 * park is laid from, a windsock, a mandatory holding sign, the localizer antenna array and the
 * glide-slope mast of the instrument landing system.
 */
import type { PropMesh } from '../../plan/contract.ts';
import { box, cone, cylinder, prop, SURFACES, transform, tube } from '../../props/index.ts';
import { AIRPORT, LIGHTS, PAINT } from './palette.ts';
import { member, repeat } from './parts.ts';

const { steel, concrete, whitePaint, signRed, darkMetal } = SURFACES;

/** 25 m of 2.4 m chain-link on posts every 3.125 m, three barbed strands on outriggers. */
function fence(): PropMesh {
  const posts = Array.from({ length: 9 }, (_, i) => -12.5 + i * 3.125);
  return prop('airport/fence', [
    ...posts.flatMap((x) => [
      transform(cylinder(concrete, 0.2, 0.3, { segments: 8, caps: true }), { at: [x, -0.2, 0] }),
      transform(cylinder(steel, 0.04, 2.4, { segments: 8 }), { at: [x, 0, 0] }),
      member(steel, [x, 2.4, 0], [x, 2.85, -0.45], [0.05, 0.05]),
    ]),
    transform(box(AIRPORT.chainLink, [25, 2.3, 0.02]), { at: [0, 0.05, 0] }),
    ...[0.1, 2.35].map((y) =>
      tube(
        steel,
        [
          [-12.5, y, 0],
          [12.5, y, 0],
        ],
        0.025,
        { segments: 6 },
      ),
    ),
    ...[0, 1, 2].map((i) =>
      tube(
        steel,
        [
          [-12.5, 2.5 + i * 0.15, -0.15 - i * 0.15],
          [12.5, 2.5 + i * 0.15, -0.15 - i * 0.15],
        ],
        0.008,
        { segments: 4 },
      ),
    ),
  ]);
}

/** A unit slab, top face at y = 0: a node scales it to its footprint and its depth. */
const slab = (id: string, surface = concrete) =>
  prop(id, [transform(box(surface, [1, 1, 1]), { at: [0, -1, 0] })]);

/** A 6 m mast and a striped sock streaming toward +X on its swivel. */
function windsock(): PropMesh {
  const bands = Array.from({ length: 5 }, (_, i) =>
    transform(
      cylinder(i % 2 ? whitePaint : AIRPORT.sockFabric, 0.45 - i * 0.06, 0.72, {
        top: 0.39 - i * 0.06,
        segments: 16,
      }),
      { at: [0.3 + i * 0.72, 6, 0], roll: -Math.PI / 2 - 0.12 },
    ),
  );
  return prop('airport/windsock', [
    transform(box(concrete, [1, 0.5, 1]), { at: [0, -0.3, 0] }),
    cylinder(steel, 0.08, 6.2, { top: 0.05, segments: 10 }),
    transform(cylinder(steel, 0.46, 0.05, { segments: 16 }), {
      at: [0.3, 6, 0],
      roll: -Math.PI / 2,
    }),
    ...bands,
    transform(cone(LIGHTS.red, 0.12, 0.2, { segments: 8 }), { at: [0, 6.2, 0] }),
  ]);
}

/** A lit mandatory sign: red panel, white legend strip, on two frangible legs. */
const holdingSign = () =>
  prop('airport/sign-holding', [
    ...repeat(cylinder(steel, 0.05, 0.5, { segments: 6 }), 2, [-1, 0, 0], [2, 0, 0]),
    transform(box(darkMetal, [3, 1.1, 0.35]), { at: [0, 0.45, 0] }),
    transform(box(signRed, [2.9, 1, 0.02]), { at: [0, 0.5, -0.18] }),
    transform(box(whitePaint, [1.6, 0.35, 0.02]), { at: [0, 0.82, -0.19] }),
    transform(box(PAINT.black, [2.9, 1, 0.02]), { at: [0, 0.5, 0.18] }),
    transform(box(PAINT.yellow, [1.4, 0.35, 0.02]), { at: [0, 0.82, 0.19] }),
  ]);

/** Sixteen log-periodic antennas on a 32 m frame, facing −Z down the runway. */
function localizer(): PropMesh {
  const xs = Array.from({ length: 16 }, (_, i) => -15 + i * 2);
  return prop('airport/localizer', [
    transform(box(concrete, [32, 0.6, 2]), { at: [0, -0.3, 0] }),
    ...xs.flatMap((x) => [
      transform(cylinder(steel, 0.05, 2.6, { segments: 6 }), { at: [x, 0.3, 0] }),
      member(steel, [x, 2.9, 0.6], [x, 2.9, -1.2], [0.08, 0.3]),
      ...[0.2, 0.9, 1.6].map((y) =>
        member(steel, [x - 0.6, y + 1.4, -0.3], [x + 0.6, y + 1.4, -0.3], [0.03, 0.03]),
      ),
    ]),
    transform(box(whitePaint, [3, 2.6, 2.4]), { at: [0, 0.3, 3] }),
  ]);
}

/** The glide-slope mast: 15 m lattice-free pole, three antennas, the equipment hut. */
const glideslope = () =>
  prop('airport/glideslope', [
    cylinder(whitePaint, 0.3, 15, { top: 0.2, segments: 12 }),
    ...[5, 9.5, 14].map((y) => transform(box(steel, [1.2, 0.8, 0.5]), { at: [0, y, -0.5] })),
    transform(box(whitePaint, [3, 2.6, 2.4]), { at: [4, 0, 0] }),
    transform(cone(LIGHTS.red, 0.15, 0.3, { segments: 8 }), { at: [0, 15, 0] }),
  ]);

export const fieldProps = (): PropMesh[] => [
  fence(),
  slab('airport/slab-concrete'),
  slab('airport/slab-asphalt', SURFACES.asphalt),
  windsock(),
  holdingSign(),
  localizer(),
  glideslope(),
];
