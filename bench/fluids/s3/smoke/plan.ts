/** Candidate workload, not a measured recommendation or a production quality setting. */
export type SmokeSpec = {
  grid: 32 | 64;
  iterations: 10 | 20;
  width: number;
  height: number;
  format: GPUTextureFormat;
  coverage: 0.0625 | 0.25 | 0.5 | 1;
  maxSteps: 128;
};
export type SmokeFrame = {
  dt: number;
  viewProjection: ArrayLike<number>;
  inverseViewProjection: ArrayLike<number>;
  eye: ArrayLike<number>;
  outputView: GPUTextureView;
};
export const SMOKE_PASSES = [
  'S3 smoke advection',
  'S3 smoke divergence',
  'S3 smoke pressure',
  'S3 smoke projection',
  'S3 smoke raymarch',
  'S3 smoke upsample',
] as const;
export function smokePlan(spec: SmokeSpec) {
  if (![32, 64].includes(spec.grid) || ![10, 20].includes(spec.iterations))
    throw new Error('FLUID_SMOKE_TIER: grid 32/64, pressure iterations 10/20');
  if (![0.0625, 0.25, 0.5, 1].includes(spec.coverage) || spec.maxSteps !== 128)
    throw new Error('FLUID_SMOKE_VIEW: declared coverage and 128 maximum steps required');
  if (![spec.width, spec.height].every((v) => Number.isSafeInteger(v) && v > 0))
    throw new Error('FLUID_SMOKE_SIZE: positive integer image dimensions required');
  const halfWidth = Math.ceil(spec.width / 2),
    halfHeight = Math.ceil(spec.height / 2);
  // Two RGBA16F velocity/density fields, two R32F pressures, one R32F divergence.
  const gridBytes = 28 * spec.grid ** 3;
  const totalBytes = gridBytes + 12 * halfWidth * halfHeight + 144;
  if (totalBytes > 64 * 1024 * 1024)
    throw new Error('FLUID_SMOKE_BUDGET: declared textures/buffers exceed 64 MiB');
  return {
    gridBytes,
    totalBytes,
    halfWidth,
    halfHeight,
    maxSteps: spec.maxSteps,
    opacityRemainder: 0.005,
    passLabels: SMOKE_PASSES,
  };
}
