import type { TransportOptions } from './lightingTransportContracts.ts';
import type { TransportState } from './lightingTransportState.ts';
import { checkpoint, progress, fail } from './lightingTransportValidation.ts';
import { maximumResidual } from './lightingTransportResidual.ts';
const PI = Math.PI;

export function solveTransport(
  state: TransportState,
  mode: 'rebuild' | 'reuse',
  options: TransportOptions,
) {
  const {
    size,
    rowSums,
    albedo,
    initialized,
    maxIterations,
    tolerance,
    matrix,
    source,
    irradiance,
    indirectIrradiance,
  } = state;
  let contraction = 0;
  for (let i = 0; i < size; i++)
    contraction = Math.max(
      contraction,
      rowSums[i] * Math.max(albedo[i * 3], albedo[i * 3 + 1], albedo[i * 3 + 2]),
    );
  if (!(contraction < 1))
    fail(
      'NON_CONTRACTIVE_TRANSPORT',
      'The sampled operator has no strict maximum-norm contraction bound',
    );
  if (mode === 'rebuild' || !initialized || options.warmStart === false) state.radiance.fill(0);
  progress(options, 'solve', 0, maxIterations);
  let iterations = 0;
  for (; iterations < maxIterations;) {
    checkpoint(options);
    let delta = 0;
    for (let i = 0; i < size; i++) {
      let red = 0,
        green = 0,
        blue = 0;
      for (let j = 0; j < size; j++) {
        const value = matrix[i * size + j],
          at = j * 3;
        red += value * state.radiance[at];
        green += value * state.radiance[at + 1];
        blue += value * state.radiance[at + 2];
      }
      const at = i * 3;
      state.next[at] = source[at] + albedo[at] * red;
      state.next[at + 1] = source[at + 1] + albedo[at + 1] * green;
      state.next[at + 2] = source[at + 2] + albedo[at + 2] * blue;
      delta = Math.max(
        delta,
        Math.abs(state.next[at] - state.radiance[at]),
        Math.abs(state.next[at + 1] - state.radiance[at + 1]),
        Math.abs(state.next[at + 2] - state.radiance[at + 2]),
      );
    }
    const previous = state.radiance;
    state.radiance = state.next;
    state.next = previous;
    iterations++;
    if (delta <= tolerance * (1 - contraction)) break;
    if ((iterations & 15) === 0) progress(options, 'solve', iterations, maxIterations);
  }
  const residual = maximumResidual(matrix, source, albedo, state.radiance, size);
  const errorBound = residual / (1 - contraction);
  if (!Number.isFinite(errorBound) || !state.radiance.every(Number.isFinite))
    fail('NUMERICAL_OVERFLOW', 'Transport radiance exceeded finite arithmetic');
  for (let i = 0; i < size; i++) {
    let red = 0,
      green = 0,
      blue = 0;
    let indirectRed = 0,
      indirectGreen = 0,
      indirectBlue = 0;
    for (let j = 0; j < size; j++) {
      const value = matrix[i * size + j],
        at = j * 3;
      red += value * state.radiance[at];
      green += value * state.radiance[at + 1];
      blue += value * state.radiance[at + 2];
      // Remove only emission. An emissive surface can also reflect incoming light.
      indirectRed += value * (state.radiance[at] - source[at]);
      indirectGreen += value * (state.radiance[at + 1] - source[at + 1]);
      indirectBlue += value * (state.radiance[at + 2] - source[at + 2]);
    }
    irradiance[i * 3] = PI * red;
    irradiance[i * 3 + 1] = PI * green;
    irradiance[i * 3 + 2] = PI * blue;
    indirectIrradiance[i * 3] = PI * indirectRed;
    indirectIrradiance[i * 3 + 1] = PI * indirectGreen;
    indirectIrradiance[i * 3 + 2] = PI * indirectBlue;
  }
  progress(options, 'solve', iterations, maxIterations);
  return { iterations, residual, errorBound, contraction, converged: errorBound <= tolerance };
}
