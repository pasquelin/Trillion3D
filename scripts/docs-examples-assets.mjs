import { resolve } from 'node:path';
import { rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { scenes } from './docs/examples/scenes.mjs';
import { geometryScenes } from './docs/examples/scenes-geometry.mjs';
import { materialScenes } from './docs/examples/scenes-materials.mjs';
import { lightScenes } from './docs/examples/scenes-lights.mjs';
import { writeSurfacesGltf } from './docs/examples/gltf.mjs';
import { writePartsGltf } from './docs/examples/gltf-parts.mjs';
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

const procedural = { ...scenes, ...geometryScenes, ...materialScenes, ...lightScenes };
const names = [...Object.keys(procedural), ...Object.keys(modelScenes)].filter(
  (name) => !only || name === only,
);
if (!names.length) throw new Error(`Unknown example scene: ${only}`);

for (const [name, scene] of Object.entries(procedural)) {
  if (!names.includes(name)) continue;
  const { name: label, materials, surfaces, parts, nodes, images = {} } = scene(),
    source = resolve(examples, name, 'source');
  // A scene is either one mesh of surfaces, or named parts placed by nodes, with the images its
  // materials read written beside the glTF.
  if (parts)
    await writePartsGltf(source, label, materials, parts, nodes, { images: Object.keys(images) });
  else await writeSurfacesGltf(source, label, materials, surfaces);
  for (const [file, bytes] of Object.entries(images)) await writeFile(resolve(source, file), bytes);
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
