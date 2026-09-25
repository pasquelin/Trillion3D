/**
 * Regenerates the scenes modelled in code — the gallery's observatory, and the mountain terrain
 * the tests read — and compiles each cache with this checkout's native compiler. An argument
 * limits the run to one scene; `--source-only` skips the compiler.
 *
 *   pnpm run docs:gallery [observatory|mountain-terrain] [--source-only]
 */
import { rm } from 'node:fs/promises';
import { nativeCompiler } from './native-compiler.ts';
import { COOKED_SCENES, compileCache, sourceOf } from './site-caches.ts';
import { writeObservatory } from './docs/observatory/write.ts';
import { mountainTerrain } from './docs/mountain-terrain/model.ts';
import { writeMountainTerrain } from './docs/mountain-terrain/write.ts';

const scenes: Record<string, (source: string) => Promise<unknown>> = {
  observatory: (source) => writeObservatory(source),
  'mountain-terrain': (source) => writeMountainTerrain(source, mountainTerrain()),
};

const only = process.argv.slice(2).find((argument) => !argument.startsWith('-'));
const names = Object.keys(scenes).filter((name) => !only || name === only);
if (!names.length) throw new Error(`Unknown gallery scene: ${only}`);
const sourceOnly = process.argv.includes('--source-only');
if (!sourceOnly) nativeCompiler();

for (const name of names) {
  const source = sourceOf(COOKED_SCENES[name]);
  await rm(source, { recursive: true, force: true });
  await scenes[name](source);
  if (!sourceOnly) compileCache(COOKED_SCENES[name]);
}
