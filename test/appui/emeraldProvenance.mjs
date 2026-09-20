import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

/**
 * The measurement resolution, declared once and recorded in the provenance.
 *
 * 2496 × 1404, the internal resolution of the published profile that `docs/REFERENCE_UE5.md`
 * compares the pass shapes against — comparing milliseconds taken at two different resolutions
 * means nothing. What we do NOT match, and must not let anyone believe: they upsample that image
 * to 4K by their temporal super-sampling; ours accumulates at native resolution and upsamples
 * nothing. It is the internal render that is the same size, not the output.
 */
export const MEASURE_WIDTH = 2496;
export const MEASURE_HEIGHT = 1404;

export async function emeraldProvenance(harnessUrl) {
  const sourceFiles = [
    'index.ts',
    'webgpuPages.ts',
    'visibilityBuffer.ts',
    'standardLighting.ts',
    'textureMips.ts',
    'surfaceBuffer.ts',
    'sceneLighting.ts',
    'deferredLighting.ts',
    'gpuPresentation.ts',
    'taaShaderWgsl.ts',
    'taaFrame.ts',
    'taaWeights.ts',
    'temporalAntialiasing.ts',
  ];
  const hashes = {};
  for (const file of sourceFiles)
    hashes[file] = createHash('sha256')
      .update(await readFile(resolve('packages/sdk-browser', file)))
      .digest('hex');
  const provenance = {
    startedAt: new Date().toISOString(),
    purpose: 'visual-only',
    harnessUrl,
    head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    hashes,
    width: MEASURE_WIDTH,
    height: MEASURE_HEIGHT,
    pixelError: 1,
    warmupFrames: 4,
    baselineOverrides: [],
  };
  return provenance;
}
