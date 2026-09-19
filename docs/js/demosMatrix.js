/** Matrix demos: each one calls the engine function of its page and shows what came back. */
import {
  adjugateFactor,
  composeMatrix4,
  decomposeMatrix4,
  determinantMatrix4,
  invertMatrix4,
  linearPartDeterminant,
  linearPartScale,
  multiplyMatrix4,
  normalMatrix3,
  normalizedLinearDeterminant,
  uniformScaleMatrix4,
} from './engine.js';
import { formatNumber, matrixView, slider, valueView, verdictView } from './demoKit.js';

const scratch = () => new Float64Array(16);

/** `out = T · R · S` from a pose the reader moves, and the decomposition that comes back. */
function poseMatrix(state) {
  const half = state.turn * 0.5;
  const quaternion = [0, Math.sin(half), 0, Math.cos(half)];
  const model = scratch();
  composeMatrix4(model, [state.x, 0, 0], quaternion, [state.scale, state.scale, state.scale]);
  return { model, quaternion };
}

export const MATRIX_DEMOS = {
  composeMatrix4: {
    controls: [
      slider('x', 'translation x', -5, 5, 1.5, 0.1),
      slider('turn', 'rotation about y (rad)', 0, 6.28, 0.8, 0.01),
      slider('scale', 'uniform scale', 0.2, 3, 1, 0.05),
    ],
    run(state) {
      const { model } = poseMatrix(state);
      const position = new Float64Array(3),
        quaternion = new Float64Array(4),
        scale = new Float64Array(3);
      decomposeMatrix4(model, position, quaternion, scale);
      return [
        matrixView(
          'composeMatrix4(out, position, quaternion, scale)',
          model,
          'column-major; the translation is [12..14]',
        ),
        valueView('decomposeMatrix4 of that matrix — the round trip', [
          ['position', Array.from(position, formatNumber).join(', ')],
          ['quaternion', Array.from(quaternion, formatNumber).join(', ')],
          ['scale', Array.from(scale, formatNumber).join(', ')],
        ]),
      ];
    },
  },
  multiplyMatrix4: {
    controls: [
      slider('x', 'translation x of A', -5, 5, 1.5, 0.1),
      slider('turn', 'rotation of A (rad)', 0, 6.28, 0.8, 0.01),
      slider('scale', 'scale of B', 0.2, 3, 1.5, 0.05),
    ],
    run(state) {
      const a = poseMatrix({ ...state, scale: 1 }).model;
      const b = scratch();
      uniformScaleMatrix4(b, state.scale, [0, 0, 0]);
      const ab = scratch(),
        ba = scratch();
      multiplyMatrix4(ab, a, b);
      multiplyMatrix4(ba, b, a);
      return [matrixView('A · B', ab), matrixView('B · A — the product does not commute', ba)];
    },
  },
  invertMatrix4: {
    controls: [
      slider('x', 'translation x', -5, 5, 1.5, 0.1),
      slider('turn', 'rotation (rad)', 0, 6.28, 0.8, 0.01),
      slider('scale', 'scale', 0, 3, 1, 0.05),
    ],
    run(state) {
      const { model } = poseMatrix(state);
      const inverse = scratch(),
        product = scratch();
      invertMatrix4(inverse, model);
      multiplyMatrix4(product, model, inverse);
      const determinant = determinantMatrix4(model);
      const singular = Array.from(inverse).every((value) => value === 0);
      return [
        matrixView('invertMatrix4(out, m)', inverse),
        matrixView('m · m⁻¹ — the identity, up to the last bits', product),
        verdictView(
          'determinant',
          !singular,
          singular
            ? `determinant ${formatNumber(determinant)}: sixteen zeros, like the reference — test the determinant, never the output`
            : `determinant ${formatNumber(determinant)}`,
        ),
      ];
    },
  },
  determinantMatrix4: {
    controls: [
      slider('scale', 'uniform scale', -2, 2, 1, 0.05),
      slider('turn', 'rotation (rad)', 0, 6.28, 0.6, 0.01),
    ],
    run(state) {
      const { model } = poseMatrix({ ...state, x: 0 });
      return [
        matrixView('the matrix under test', model),
        valueView('what the two determinants say', [
          ['determinantMatrix4(m)', formatNumber(determinantMatrix4(model))],
          ['linearPartDeterminant(m)', formatNumber(linearPartDeterminant(model))],
        ]),
        verdictView(
          'orientation',
          linearPartDeterminant(model) > 0,
          linearPartDeterminant(model) > 0
            ? 'positive: the draw keeps its front faces'
            : 'negative: the transform mirrors, and the draw swaps front and back',
        ),
      ];
    },
  },
  normalMatrix3: {
    controls: [
      slider('sx', 'scale x', 0, 3, 1, 0.05),
      slider('sy', 'scale y', 0, 3, 2, 0.05),
      slider('sz', 'scale z', 0, 3, 1, 0.05),
    ],
    run(state) {
      const model = scratch();
      composeMatrix4(model, [0, 0, 0], [0, 0, 0, 1], [state.sx, state.sy, state.sz]);
      const normal = new Float64Array(9);
      normalMatrix3(normal, model);
      const determinant = normalizedLinearDeterminant(model);
      const factor = adjugateFactor(model, linearPartDeterminant(model));
      return [
        valueView('normalMatrix3(out, m) — nine numbers, column-major', [
          ['column 0', Array.from(normal.subarray(0, 3), formatNumber).join(', ')],
          ['column 1', Array.from(normal.subarray(3, 6), formatNumber).join(', ')],
          ['column 2', Array.from(normal.subarray(6, 9), formatNumber).join(', ')],
        ]),
        valueView("the engine's singularity rule", [
          ['linearPartScale(m)', formatNumber(linearPartScale(model))],
          ['normalizedLinearDeterminant(m)', formatNumber(determinant)],
          [
            'adjugateFactor',
            factor === null
              ? 'null — the adjugate itself is replaced by zero'
              : formatNumber(factor),
          ],
        ]),
        verdictView(
          'surface',
          factor !== null && Math.abs(determinant) > 1e-20,
          factor === 1
            ? 'singular: the adjugate as-is, so the flattened surface keeps a normal'
            : factor === null
              ? 'no finite scale: nine zeros'
              : 'regular: the inverse-transpose, at the reference bits',
        ),
      ];
    },
  },
};
