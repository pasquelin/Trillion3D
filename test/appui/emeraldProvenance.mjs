import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

/**
 * La résolution de relevé, déclarée une fois et consignée dans la provenance.
 *
 * 2496 × 1404, la résolution interne du profil publié auquel `docs/REFERENCE_UE5.md` compare la
 * forme des passes — comparer des millisecondes prises à deux résolutions différentes ne veut rien
 * dire. Ce qu'on n'égale PAS, et qu'il ne faut pas laisser croire : eux remontent cette image en 4K
 * par leur antialiasing temporel, que nous n'avons pas (Lumière 16). C'est le rendu interne qui est
 * à la même taille, pas la sortie.
 */
export const MEASURE_WIDTH = 2496;
export const MEASURE_HEIGHT = 1404;

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
    width: MEASURE_WIDTH,
    height: MEASURE_HEIGHT,
    pixelError: 1,
    warmupFrames: 4,
    baselineOverrides: [],
  };
  return provenance;
}
