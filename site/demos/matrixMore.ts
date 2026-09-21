/** Matrix demos, continued: the buffer conventions and the two builders of batch A. */
import { IDENTITY_MATRIX4, basisMatrix4, copyMatrix4, uniformScaleMatrix4 } from './engine.ts';
import { matrixView, slider, valueView } from './kit.ts';
import type { DemoDef } from './kit.ts';

const scratch = () => new Float64Array(16);

export const MATRIX_MORE_DEMOS: Record<string, DemoDef> = {
  copyMatrix4: {
    controls: [slider('at', 'destination offset (matrices)', 0, 3, 1, 1)],
    run(state) {
      const buffer = new Float64Array(64);
      copyMatrix4(buffer, IDENTITY_MATRIX4, state.at * 16);
      return [
        matrixView(
          `the identity written at offset ${state.at * 16} of one large buffer`,
          buffer.subarray(state.at * 16, state.at * 16 + 16),
          'one buffer holds many matrices; no view is sliced per frame',
        ),
        valueView('the buffer', [
          ['length', String(buffer.length)],
          ['non-zero values', String(buffer.filter((value) => value !== 0).length)],
        ]),
      ];
    },
  },
  basisMatrix4: {
    controls: [
      slider('turn', 'turn of the basis (rad)', 0, 6.28, 0.6, 0.01),
      slider('scale', 'uniform scale', 0.2, 3, 1.5, 0.05),
    ],
    run(state) {
      const cos = Math.cos(state.turn),
        sin = Math.sin(state.turn);
      const basis = scratch();
      basisMatrix4(basis, [cos, 0, -sin], [0, 1, 0], [sin, 0, cos], [2, 0, 0]);
      const scaled = scratch();
      uniformScaleMatrix4(scaled, state.scale, [1, 1, 0]);
      return [
        matrixView('basisMatrix4(out, u, v, n, origin)', basis),
        matrixView('uniformScaleMatrix4(out, s, center) — the centre stays put', scaled),
      ];
    },
  },
};
