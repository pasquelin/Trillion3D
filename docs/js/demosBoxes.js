/** Box and sphere demos: the arithmetic every cluster bound goes through. */
import {
  BOX_VALUES,
  boxConeRejects,
  boxTransform,
  boxUnion,
  composeMatrix4,
  sphereFromBounds,
} from './engine.js';
import { formatNumber, slider, valueView, verdictView } from './demoKit.js';

export const BOX_DEMOS = {
  boxUnion: {
    controls: [
      slider('x', 'second box, x', -3, 3, 1.5, 0.1),
      slider('z', 'second box, z', -3, 3, 1, 0.1),
    ],
    run(state) {
      const out = new Float64Array(BOX_VALUES);
      out.set([-1, -1, -1, 1, 1, 1]);
      boxUnion(out, 0, state.x - 0.6, -0.6, state.z - 0.6, state.x + 0.6, 0.6, state.z + 0.6);
      const sphere = new Float64Array(4);
      sphereFromBounds(sphere, 0, ...out);
      return [
        valueView('boxUnion of the unit box and the one you move', [
          ['lower bounds', Array.from(out.subarray(0, 3), formatNumber).join(', ')],
          ['upper bounds', Array.from(out.subarray(3, 6), formatNumber).join(', ')],
        ]),
        valueView('sphereFromBounds of that union', [
          ['centre', Array.from(sphere.subarray(0, 3), formatNumber).join(', ')],
          ['radius', formatNumber(sphere[3])],
        ]),
      ];
    },
  },
  boxTransform: {
    controls: [
      slider('turn', 'rotation of the matrix (rad)', 0, 6.28, 0.6, 0.01),
      slider('scale', 'scale', 0.2, 3, 1, 0.05),
    ],
    run(state) {
      const m = new Float64Array(16);
      const half = state.turn * 0.5;
      composeMatrix4(
        m,
        [1, 0, 0],
        [0, Math.sin(half), 0, Math.cos(half)],
        [state.scale, state.scale, state.scale],
      );
      const box = new Float64Array([-1, -1, -1, 1, 1, 1]);
      const out = new Float64Array(BOX_VALUES);
      boxTransform(out, 0, box, 0, m);
      return [
        valueView('the unit box carried by that matrix', [
          ['lower bounds', Array.from(out.subarray(0, 3), formatNumber).join(', ')],
          ['upper bounds', Array.from(out.subarray(3, 6), formatNumber).join(', ')],
          ['note', 'the union of the eight transformed corners, never the eight of the result'],
        ]),
      ];
    },
  },
  boxConeRejects: {
    controls: [
      slider('angle', 'cone half-angle (rad)', 0, 1.57, 0.5, 0.01),
      slider('axis', 'cone axis, heading (rad)', 0, 6.28, 0, 0.01),
      slider('distance', 'viewer distance', 1, 12, 6, 0.1),
    ],
    run(state) {
      const world = new Float64Array(16);
      composeMatrix4(world, [0, 0, 0], [0, 0, 0, 1], [1, 1, 1]);
      const normal = new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
      const axis = [Math.cos(state.axis), 0, Math.sin(state.axis)];
      const rejects = boxConeRejects(
        axis,
        state.angle,
        [-1, -1, -1],
        [1, 1, 1],
        world,
        normal,
        1,
        0,
        0,
        state.distance,
      );
      return [
        verdictView(
          'boxConeRejects',
          !rejects,
          rejects
            ? 'rejected: every normal of that cluster faces away from the viewer'
            : 'kept: the cone may still face the viewer',
        ),
        valueView('what the test read', [
          ['cone axis', axis.map(formatNumber).join(', ')],
          ['half-angle', `${formatNumber((state.angle * 180) / Math.PI)}°`],
          ['viewer', `0, 0, ${formatNumber(state.distance)}`],
          ['note', 'an angle at or above π/2 never rejects'],
        ]),
      ];
    },
  },
};
