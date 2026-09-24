/**
 * Regenerates the gallery scenes modelled in code — the observatory and the mountain terrain,
 * under `site/assets/gallery/` — and compiles each published cache with this checkout's native
 * compiler. An argument limits the run to one scene; `--source-only` skips the compiler.
 *
 *   pnpm run docs:gallery [observatory|mountain-terrain] [--source-only]
 */
import { resolve } from 'node:path';
import { rm } from 'node:fs/promises';
import { compileFullCache, nativeCompiler } from './native-compiler.ts';
import { writeObservatory } from './docs/observatory/write.ts';
import { mountainTerrain } from './docs/mountain-terrain/model.ts';
import { writeMountainTerrain } from './docs/mountain-terrain/write.ts';

const gallery = resolve(import.meta.dirname, '../site/assets/gallery');
const scenes: Record<string, { directory: string; write: (source: string) => Promise<unknown> }> = {
  observatory: {
    directory: resolve(gallery, 'signature-architecture'),
    write: (source) => writeObservatory(source),
  },
  'mountain-terrain': {
    directory: resolve(gallery, 'offline/terrain'),
    write: (source) => writeMountainTerrain(source, mountainTerrain()),
  },
};

const only = process.argv.slice(2).find((argument) => !argument.startsWith('-'));
const names = Object.keys(scenes).filter((name) => !only || name === only);
if (!names.length) throw new Error(`Unknown gallery scene: ${only}`);
const sourceOnly = process.argv.includes('--source-only');
if (!sourceOnly) nativeCompiler();

for (const name of names) {
  const { directory, write } = scenes[name];
  await rm(resolve(directory, 'source'), { recursive: true, force: true });
  await write(resolve(directory, 'source'));
  if (sourceOnly) continue;
  await rm(resolve(directory, 'cache'), { recursive: true, force: true });
  compileFullCache({
    cwd: directory,
    source: 'source/geometry.gltf',
    simplification: 'qem-endpoints',
  });
  await rm(resolve(directory, 'cache/native/.lock'), { force: true });
}
