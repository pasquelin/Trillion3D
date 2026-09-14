export function maximumResidual(
  matrix: Float64Array,
  source: Float64Array,
  albedo: Float64Array,
  radiance: Float64Array,
  size: number,
): number {
  let maximum = 0;
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
    maximum = Math.max(
      maximum,
      Math.abs(source[at] + albedo[at] * red - radiance[at]),
      Math.abs(source[at + 1] + albedo[at + 1] * green - radiance[at + 1]),
      Math.abs(source[at + 2] + albedo[at + 2] * blue - radiance[at + 2]),
    );
  }
  return maximum;
}
