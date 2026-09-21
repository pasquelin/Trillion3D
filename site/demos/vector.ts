/** Vector and colour demos: the engine function runs on what the reader sets, live. */
import {
  addScaledVector3,
  copyScaledVector3,
  crossVector3,
  dotVector3,
  lengthSqVector3,
  normalizeVector3,
  scaleVector3,
} from './engine.ts';
import { canvasView, formatNumber, slider, valueView } from './kit.ts';
import type { DemoDef, DemoState } from './kit.ts';
import { drawVectors } from './draw.ts';

const vector = (x: number, y: number, z: number) => new Float64Array([x, y, z]);
const show = (v: Float64Array) => Array.from(v, formatNumber).join(', ');

/** Two vectors the reader turns, in the xz plane, plus their heights. */
function pair(state: DemoState) {
  return {
    a: vector(Math.cos(state.angleA), state.heightA, Math.sin(state.angleA)),
    b: vector(Math.cos(state.angleB), 0, Math.sin(state.angleB)),
  };
}

const PAIR_CONTROLS = [
  slider('angleA', 'direction of a (rad)', 0, 6.28, 0.4, 0.01),
  slider('heightA', 'height of a', -2, 2, 0.5, 0.05),
  slider('angleB', 'direction of b (rad)', 0, 6.28, 1.9, 0.01),
];

export const VECTOR_DEMOS: Record<string, DemoDef> = {
  dotVector3: {
    controls: PAIR_CONTROLS,
    run(state) {
      const { a, b } = pair(state);
      const dot = dotVector3(a, b);
      const cosine = dot / Math.sqrt(lengthSqVector3(a) * lengthSqVector3(b));
      return [
        valueView('what the engine returns', [
          ['a', show(a)],
          ['b', show(b)],
          ['dotVector3(a, b)', formatNumber(dot)],
          [
            'angle between them',
            `${formatNumber((Math.acos(Math.min(1, Math.max(-1, cosine))) * 180) / Math.PI)}°`,
          ],
        ]),
        canvasView('a and b, seen from above (x to the right, z down)', (context, width, height) =>
          drawVectors(context, width, height, [
            { v: a, colour: '#3987e5', label: 'a' },
            { v: b, colour: '#d95926', label: 'b' },
          ]),
        ),
      ];
    },
  },
  crossVector3: {
    controls: PAIR_CONTROLS,
    run(state) {
      const { a, b } = pair(state);
      const out = vector(0, 0, 0);
      crossVector3(out, a, b);
      const aliased = new Float64Array(a);
      crossVector3(aliased, aliased, b);
      return [
        valueView('what the engine returns', [
          ['crossVector3(out, a, b)', show(out)],
          ['its length', formatNumber(Math.sqrt(lengthSqVector3(out)))],
          ['out = a, aliased', show(aliased)],
        ]),
        canvasView('a, b and their cross product, from above', (context, width, height) =>
          drawVectors(context, width, height, [
            { v: a, colour: '#3987e5', label: 'a' },
            { v: b, colour: '#d95926', label: 'b' },
            { v: out, colour: '#199e70', label: 'a × b' },
          ]),
        ),
      ];
    },
  },
  lengthSqVector3: {
    controls: [
      slider('x', 'x', -4, 4, 3, 0.1),
      slider('y', 'y', -4, 4, 1, 0.1),
      slider('z', 'z', -4, 4, 2, 0.1),
    ],
    run(state) {
      const v = vector(state.x, state.y, state.z);
      const squared = lengthSqVector3(v);
      const normalized = new Float64Array(v);
      normalizeVector3(normalized);
      return [
        valueView('what the engine returns', [
          ['lengthSqVector3(v)', formatNumber(squared)],
          ['Math.sqrt of it — the reference length, bit for bit', formatNumber(Math.sqrt(squared))],
          ['normalizeVector3(v)', show(normalized)],
          ['length of the normalised vector', formatNumber(Math.sqrt(lengthSqVector3(normalized)))],
        ]),
      ];
    },
  },
  normalizeVector3: {
    controls: [
      slider('x', 'x', -4, 4, 0, 0.1),
      slider('y', 'y', -4, 4, 0, 0.1),
      slider('z', 'z', -4, 4, 0, 0.1),
    ],
    run(state) {
      const v = vector(state.x, state.y, state.z);
      const before = show(v);
      normalizeVector3(v);
      return [
        valueView('in place', [
          ['before', before],
          ['after', show(v)],
          ['length', formatNumber(Math.sqrt(lengthSqVector3(v)))],
        ]),
        valueView('the zero vector', [
          ['note', 'all three at zero: nothing changes — the divisor is `length || 1`'],
        ]),
      ];
    },
  },
  scaleVector3: {
    controls: [slider('s', 'scalar', -3, 3, 1.5, 0.05)],
    run(state) {
      const inPlace = vector(1, 2, 3);
      scaleVector3(inPlace, state.s);
      const copied = vector(0, 0, 0);
      copyScaledVector3(copied, [1, 2, 3], state.s);
      const added = vector(1, 1, 1);
      addScaledVector3(added, [1, 2, 3], state.s);
      return [
        valueView('the same (1, 2, 3), three ways', [
          ['scaleVector3(out, s)', show(inPlace)],
          ['copyScaledVector3(out, a, s)', show(copied)],
          ['addScaledVector3(out, a, s) onto (1, 1, 1)', show(added)],
        ]),
      ];
    },
  },
};
