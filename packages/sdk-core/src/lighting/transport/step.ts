/**
 * One Jacobi step of the transport: `next = source + albedo ⊙ (matrix · radiance)`, row by row.
 * Returns the largest change `|next − radiance|` over every channel — the step's progress while
 * iterating, and the residual of a radiance once it is taken as the solution.
 */
export function transportStep(
  matrix: Float64Array,
  source: Float64Array,
  albedo: Float64Array,
  radiance: Float64Array,
  next: Float64Array,
  size: number,
): number {
  let delta = 0;
  for (let i = 0; i < size; i++) {
    let red = 0,
      green = 0,
      blue = 0;
    for (let j = 0; j < size; j++) {
      const value = matrix[i * size + j],
        at = j * 3;
      red += value * radiance[at];
      green += value * radiance[at + 1];
      blue += value * radiance[at + 2];
    }
    const at = i * 3;
    next[at] = source[at] + albedo[at] * red;
    next[at + 1] = source[at + 1] + albedo[at + 1] * green;
    next[at + 2] = source[at + 2] + albedo[at + 2] * blue;
    delta = Math.max(
      delta,
      Math.abs(next[at] - radiance[at]),
      Math.abs(next[at + 1] - radiance[at + 1]),
      Math.abs(next[at + 2] - radiance[at + 2]),
    );
  }
  return delta;
}

/** The residual of a radiance taken as the solution: how far one more step would move it. */
export function maximumResidual(
  matrix: Float64Array,
  source: Float64Array,
  albedo: Float64Array,
  radiance: Float64Array,
  size: number,
): number {
  return transportStep(matrix, source, albedo, radiance, new Float64Array(size * 3), size);
}
