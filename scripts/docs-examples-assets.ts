import { resolve } from 'node:path';
import { rm } from 'node:fs/promises';
import { modelScenes, writeModelScenes } from './docs/examples/models.ts';
import { compileFullCache } from './native-compiler.ts';

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

await writeModelScenes(examples, resolve(examples, 'models'), names);
if (process.argv.includes('--source-only')) process.exit(0);

for (const name of names) {
  const directory = resolve(examples, name);
  await rm(resolve(directory, 'cache'), { recursive: true, force: true });
  // The source folder holds one glTF or the OBJ files to merge.
  compileFullCache({
    cwd: directory,
    source: 'source',
    simplification: 'qem-endpoints',
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  await rm(resolve(directory, 'cache/native/.lock'), { force: true });
}
