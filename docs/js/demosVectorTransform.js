/** Vector demos, continued: a point and a direction carried by a matrix. */
import {
  applyMatrix3Vector3,
  composeMatrix4,
  transformAffinePoint,
  transformDirectionVector3,
  transformHomogeneousPoint,
} from './engine.js';
import { canvasView, formatNumber, slider, valueView } from './demoKit.js';
import { drawVectors } from './demoDraw.js';

const vector = (x, y, z) => new Float64Array([x, y, z]);
const show = (v) => Array.from(v, formatNumber).join(', ');

export const VECTOR_TRANSFORM_DEMOS = {
  transformAffinePoint: {
    controls: [
      slider('turn', 'rotation of the matrix (rad)', 0, 6.28, 0.7, 0.01),
      slider('x', 'point x', -3, 3, 1, 0.1),
      slider('z', 'point z', -3, 3, 0.5, 0.1),
    ],
    run(state) {
      const half = state.turn * 0.5;
      const m = new Float64Array(16);
      composeMatrix4(m, [2, 0, 0], [0, Math.sin(half), 0, Math.cos(half)], [1, 1, 1]);
      const point = vector(0, 0, 0);
      transformAffinePoint(point, m, state.x, 0, state.z);
      const clip = new Float64Array(4);
      transformHomogeneousPoint(clip, m, state.x, 0, state.z);
      return [
        valueView('the same point, both ways', [
          ['transformAffinePoint(out, m, x, y, z)', show(point)],
          ['transformHomogeneousPoint — four components', show(clip)],
          ['w', formatNumber(clip[3])],
        ]),
        canvasView('the point before and after, from above', (context, width, height) =>
          drawVectors(context, width, height, [
            { v: vector(state.x, 0, state.z), colour: '#898781', label: 'before' },
            { v: point, colour: '#3987e5', label: 'after' },
          ]),
        ),
      ];
    },
  },
  transformDirectionVector3: {
    controls: [
      slider('turn', 'rotation (rad)', 0, 6.28, 0.7, 0.01),
      slider('scale', 'scale of the matrix', 0.2, 3, 2, 0.05),
    ],
    run(state) {
      const half = state.turn * 0.5;
      const m = new Float64Array(16);
      composeMatrix4(
        m,
        [5, 5, 5],
        [0, Math.sin(half), 0, Math.cos(half)],
        [state.scale, state.scale, state.scale],
      );
      const direction = vector(0, 0, 0);
      transformDirectionVector3(direction, m, 1, 0, 0);
      const applied = vector(0, 0, 0);
      applyMatrix3Vector3(
        applied,
        [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]],
        1,
        0,
        0,
      );
      return [
        valueView('the direction (1, 0, 0) under that matrix', [
          ['transformDirectionVector3 — normalised, translation ignored', show(direction)],
          ['applyMatrix3Vector3 on the 3×3 block — not normalised', show(applied)],
        ]),
      ];
    },
  },
};
