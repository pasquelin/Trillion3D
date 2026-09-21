import { resolve } from 'node:path';
import { rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { scenes } from './docs/examples/scenes.mjs';
import { writeSurfacesGltf } from './docs/examples/gltf.mjs';
import { modelScenes, writeModelScenes } from './docs/examples/models.mjs';

/**
 * Writes the sources of the example scenes under `site/assets/examples/<scene>/source` — the
 * original procedural ones as glTF, the ones built around an imported model as merged OBJ
 * folders — then compiles each with this checkout's native compiler. An argument limits the run
 * to one scene; `--source-only` skips the compiler.
 */
const root = resolve(import.meta.dirname, '..'),
  examples = resolve(root, 'site/assets/examples'),
  only = process.argv.slice(2).find((argument) => !argument.startsWith('-')),
  compiler =
    process.env.WG_COMPILER ??
    resolve(root, 'packages/asset-compiler-rust/target/release/web-geometry-compiler');

const names = [...Object.keys(scenes), ...Object.keys(modelScenes)].filter(
  (name) => !only || name === only,
);
if (!names.length) throw new Error(`Unknown example scene: ${only}`);

for (const [name, scene] of Object.entries(scenes)) {
  if (!names.includes(name)) continue;
  const { name: label, materials, surfaces } = scene();
  await writeSurfacesGltf(resolve(examples, name, 'source'), label, materials, surfaces);
}
await writeModelScenes(examples, resolve(examples, 'models'), names);
if (process.argv.includes('--source-only')) process.exit(0);

for (const name of names) {
  const directory = resolve(examples, name);
  await rm(resolve(directory, 'cache'), { recursive: true, force: true });
  // The source folder holds one glTF or the OBJ files to merge; relative paths, from the scene
  // folder, since the compiler records the paths it was given and a cache that names the machine
  // it was built on is refused (`depot-autonome.test.mjs`).
  const result = spawnSync(
    compiler,
    ['source', 'cache', 'full', '150000', '2', '256', '../../../../source/', 'qem-endpoints'],
    { cwd: directory, stdio: ['ignore', 'ignore', 'inherit'] },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Example scene compilation failed: ${name}`);
  await rm(resolve(directory, 'cache/native/.lock'), { force: true });
}
