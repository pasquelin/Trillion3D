import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { modelScenes, writeModelScenes } from './docs/examples/models.ts';

/**
 * Writes the sources of the example scenes built around an imported model, under
 * `site/assets/examples/<scene>/source` as merged OBJ folders, then compiles each with this
 * checkout's native compiler. An argument limits the run to one scene; `--source-only` skips
 * the compiler.
 */
const root = resolve(import.meta.dirname, '..'),
  examples = resolve(root, 'site/assets/examples'),
  only = process.argv.slice(2).find((argument) => !argument.startsWith('-')),
  compiler =
    process.env.WG_COMPILER ??
    resolve(root, 'packages/asset-compiler-rust/target/release/web-geometry-compiler');

const names = Object.keys(modelScenes).filter((name) => !only || name === only);
if (!names.length) throw new Error(`Unknown example scene: ${only}`);

await writeModelScenes(examples, resolve(examples, 'models'), names);
if (process.argv.includes('--source-only')) process.exit(0);

for (const name of names) {
  const directory = resolve(examples, name);
  await rm(resolve(directory, 'cache'), { recursive: true, force: true });
  // The source folder holds one glTF or the OBJ files to merge; relative paths, from the scene
  // folder, since the compiler records the paths it was given and a cache that names the machine
  // it was built on is refused (`depot-autonome.test.ts`).
  const result = spawnSync(
    compiler,
    ['source', 'cache', 'full', '150000', '2', '256', '../../../../source/', 'qem-endpoints'],
    { cwd: directory, stdio: ['ignore', 'ignore', 'inherit'] },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Example scene compilation failed: ${name}`);
  await rm(resolve(directory, 'cache/native/.lock'), { force: true });
}
