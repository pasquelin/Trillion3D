import {
  LIGHTING_TRANSPORT_ALGORITHM_VERSION,
  LIGHTING_TRANSPORT_FORMAT_VERSION,
  type TransportSnapshot,
} from './contracts.ts';

/**
 * The snapshot whose radiance is `solution`: its source is `(I − albedo ⊙ matrix) · solution`, per
 * channel, so the oracle must return `solution` whatever pivots it takes.
 */
export function system(matrix: number[], albedo: number[], solution: number[]): TransportSnapshot {
  const size = solution.length / 3;
  const source = solution.map((value, at) => {
    const row = Math.floor(at / 3),
      channel = at % 3;
    let sum = value;
    for (let j = 0; j < size; j++)
      sum -= albedo[at] * matrix[row * size + j] * solution[j * 3 + channel];
    return sum;
  });
  return {
    formatVersion: LIGHTING_TRANSPORT_FORMAT_VERSION,
    algorithmVersion: LIGHTING_TRANSPORT_ALGORITHM_VERSION,
    patchCount: size,
    matrix: Float64Array.from(matrix),
    source: Float64Array.from(source),
    albedo: Float64Array.from(albedo),
  };
}
export const ones = (size: number) => Array.from({ length: size * 3 }, () => 1);
