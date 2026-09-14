import {
  LIGHTING_TRANSPORT_ALGORITHM_VERSION,
  LIGHTING_TRANSPORT_FORMAT_VERSION,
  type TransportSnapshot,
  type TransportOptions,
} from './lightingTransportContracts.ts';
import { fail, checkpoint, progress } from './lightingTransportValidation.ts';
import { maximumResidual } from './lightingTransportResidual.ts';

/** Independent direct linear solve; never calls the iterative solver. Work is outside measured runs. */
export function solveTransportOracle(
  snapshot: TransportSnapshot,
  options: Pick<TransportOptions, 'cancelled' | 'onProgress'> = {},
) {
  const size = snapshot.patchCount;
  if (
    snapshot.formatVersion !== LIGHTING_TRANSPORT_FORMAT_VERSION ||
    snapshot.algorithmVersion !== LIGHTING_TRANSPORT_ALGORITHM_VERSION ||
    !Number.isSafeInteger(size) ||
    size < 1 ||
    snapshot.matrix.length !== size * size ||
    snapshot.source.length !== size * 3 ||
    snapshot.albedo.length !== size * 3
  )
    fail('INVALID_SNAPSHOT', 'Incompatible transport snapshot');
  if (
    ![snapshot.matrix, snapshot.source, snapshot.albedo].every((values) =>
      values.every(Number.isFinite),
    )
  )
    fail('INVALID_SNAPSHOT', 'Snapshot contains nonfinite values');
  const matrix = new Float64Array(size * size),
    rhs = new Float64Array(size),
    result = new Float64Array(size * 3);
  for (let channel = 0; channel < 3; channel++) {
    checkpoint(options);
    for (let i = 0; i < size; i++) {
      rhs[i] = snapshot.source[i * 3 + channel];
      for (let j = 0; j < size; j++)
        matrix[i * size + j] =
          (i === j ? 1 : 0) - snapshot.albedo[i * 3 + channel] * snapshot.matrix[i * size + j];
    }
    for (let pivot = 0; pivot < size; pivot++) {
      if ((pivot & 15) === 0) progress(options, 'oracle', channel * size + pivot, size * 3);
      let winner = pivot;
      for (let row = pivot + 1; row < size; row++)
        if (Math.abs(matrix[row * size + pivot]) > Math.abs(matrix[winner * size + pivot]))
          winner = row;
      if (Math.abs(matrix[winner * size + pivot]) < 1e-14)
        fail('SINGULAR_TRANSPORT', 'Transport oracle encountered a singular system');
      if (winner !== pivot) {
        for (let col = pivot; col < size; col++) {
          const temporary = matrix[pivot * size + col];
          matrix[pivot * size + col] = matrix[winner * size + col];
          matrix[winner * size + col] = temporary;
        }
        const temporary = rhs[pivot];
        rhs[pivot] = rhs[winner];
        rhs[winner] = temporary;
      }
      for (let row = pivot + 1; row < size; row++) {
        const factor = matrix[row * size + pivot] / matrix[pivot * size + pivot];
        matrix[row * size + pivot] = 0;
        if (factor === 0) continue;
        for (let col = pivot + 1; col < size; col++)
          matrix[row * size + col] -= factor * matrix[pivot * size + col];
        rhs[row] -= factor * rhs[pivot];
      }
    }
    for (let row = size - 1; row >= 0; row--) {
      let value = rhs[row];
      for (let col = row + 1; col < size; col++)
        value -= matrix[row * size + col] * result[col * 3 + channel];
      result[row * 3 + channel] = value / matrix[row * size + row];
    }
  }
  progress(options, 'oracle', size * 3, size * 3);
  return {
    radiance: result,
    residual: maximumResidual(snapshot.matrix, snapshot.source, snapshot.albedo, result, size),
  };
}
