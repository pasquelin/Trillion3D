import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

export async function emeraldProvenance(labRoot) {
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
  ];
  const hashes = {};
  for (const file of sourceFiles)
    hashes[file] = createHash('sha256')
      .update(await readFile(resolve('packages/sdk-browser', file)))
      .digest('hex');
  const provenance = {
    startedAt: new Date().toISOString(),
    purpose: 'visual-only',
    labRoot,
    labUrl: process.env.LAB_URL ?? 'http://localhost:5174',
    head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    hashes,
    width: 1012,
    height: 1000,
    pixelError: 1,
    warmupFrames: 4,
    baselineOverrides: [],
  };
  return provenance;
}
