import type { S3Case, S3Options } from './contracts.ts';

/** Enumerate costs the issue asks to measure; no candidate is labelled a retained tier. */
export function s3Cases(): S3Case[] {
  const cases: S3Case[] = [];
  for (const backend of ['webgl2', 'webgpu'] as const)
    for (const resolution of [256, 512] as const)
      for (const rate of [30, 15] as const)
        for (const splats of [0, 64] as const)
          cases.push({ kind: 'ripples', backend, resolution, rate, splats });
  for (const grid of [32, 64] as const)
    for (const iterations of [10, 20] as const)
      for (const coverage of [0.0625, 0.25, 0.5, 1] as const)
        cases.push({ kind: 'smoke', backend: 'webgpu', grid, iterations, coverage, maxSteps: 128 });
  return cases;
}

/** Refuse malformed caller input before allocating a canvas or GPU state. */
export function validateOptions(options: S3Options) {
  for (const key of ['width', 'height', 'warmup', 'frames'] as const) {
    const value = options[key];
    if (!Number.isSafeInteger(value) || value < (key === 'warmup' ? 0 : 1))
      throw new RangeError(
        `${key} must be a ${key === 'warmup' ? 'non-negative' : 'positive'} integer`,
      );
  }
  if (options.width > 4096 || options.height > 4096 || options.frames + options.warmup > 36000)
    throw new RangeError('S3 capture exceeds its bounded canvas or frame count');
  if (typeof options.enabled !== 'boolean') throw new TypeError('enabled must be boolean');
  const candidate = options.case;
  const valid =
    candidate.kind === 'ripples'
      ? ['webgl2', 'webgpu'].includes(candidate.backend) &&
        [256, 384, 512].includes(candidate.resolution) &&
        [30, 15, 7.5].includes(candidate.rate) &&
        [0, 64].includes(candidate.splats)
      : candidate.kind === 'smoke' &&
        candidate.backend === 'webgpu' &&
        [32, 64].includes(candidate.grid) &&
        [10, 20].includes(candidate.iterations) &&
        [0.0625, 0.25, 0.5, 1].includes(candidate.coverage) &&
        candidate.maxSteps === 128;
  if (!valid) throw new RangeError('Unsupported S3 candidate');
}

/** CSS dimensions become actual storage dimensions before any GPU allocation. */
export function canvasDimensions(width: number, height: number, dpr: number) {
  const pixels = [Math.round(width * dpr), Math.round(height * dpr)] as const;
  if (
    !Number.isFinite(dpr) ||
    dpr <= 0 ||
    pixels.some((v) => !Number.isSafeInteger(v) || v < 1 || v > 4096)
  )
    throw new RangeError('S3 physical canvas exceeds its 4096×4096 bound');
  return pixels;
}
