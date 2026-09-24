/**
 * River bridges of the plan's roads, built from one 24 m span (a deck on two steel box girders,
 * walkways, railings) and a pier that reaches down to the river bed. Spans run along +X; the
 * placement stretches a span to the bridge's length and width.
 */
import type { PropMesh } from '../../plan/contract.ts';
import { box, cylinder, prop, SURFACES, transform } from '../../props/index.ts';
import { CITY } from './surfaces.ts';

export const SPAN = { length: 24, width: 20, walkway: 3, depth: 2.2 } as const;

export function bridgeSpan(): PropMesh {
  const { length, width, walkway, depth } = SPAN,
    edge = width / 2 + walkway;
  return prop('city/bridge-span', [
    transform(box(CITY.quay, [length, 0.6, width + 2 * walkway]), { at: [0, -0.6, 0] }),
    ...[-1, 1].flatMap((s) => [
      transform(box(CITY.paving, [length, 0.2, walkway]), {
        at: [0, 0, s * (width / 2 + walkway / 2)],
      }),
      transform(box(SURFACES.paintedMetal, [length, depth, 1.2]), {
        at: [0, -0.6 - depth, s * width * 0.3],
      }),
      transform(box(CITY.railing, [length, 0.08, 0.1]), { at: [0, 1.15, s * (edge - 0.1)] }),
      ...Array.from({ length: 12 }, (_, i) =>
        transform(box(CITY.railing, [0.08, 1.0, 0.08]), {
          at: [-length / 2 + 1 + i * 2, 0.2, s * (edge - 0.1)],
        }),
      ),
    ]),
  ]);
}

/** A 30 m pier: a round column under a crosshead, its top at y = 0 (under the girders). */
export const bridgePier = (): PropMesh =>
  prop('city/bridge-pier', [
    transform(cylinder(CITY.quay, 1.8, 28, { segments: 16 }), { at: [0, -30, 0] }),
    transform(box(CITY.quay, [3, 2, SPAN.width]), { at: [0, -2, 0] }),
  ]);
