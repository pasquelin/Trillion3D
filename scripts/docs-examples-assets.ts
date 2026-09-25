import { resolve } from 'node:path';
import { modelScenes, writeModelScenes } from './docs/examples/models.ts';
import { nativeCompiler } from './native-compiler.ts';
import { COOKED_SCENES, compileCache } from './site-caches.ts';

/**
 * Writes the sources of the example scenes, under `site/assets/examples/<scene>/source` — an
 * imported model with its setting, or a scene modelled in code — then compiles each with this
 * checkout's native compiler. An argument limits the run to one scene; `--source-only` skips
 * the compiler.
 */
const root = resolve(import.meta.dirname, '..'),
  examples = resolve(root, 'site/assets/examples'),
  only = process.argv.slice(2).find((argument) => !argument.startsWith('-'));

const names = Object.keys(modelScenes).filter((name) => !only || name === only);
if (!names.length) throw new Error(`Unknown example scene: ${only}`);
const sourceOnly = process.argv.includes('--source-only');
if (!sourceOnly) nativeCompiler();

await writeModelScenes(examples, resolve(examples, 'models'), names);
if (sourceOnly) process.exit(0);

// Every cache of a rewritten source: the terrain tiles' exact cook with their simplified one.
const directories = new Set(names.map((name) => COOKED_SCENES[name].directory));
for (const scene of Object.values(COOKED_SCENES))
  if (directories.has(scene.directory)) compileCache(scene);
