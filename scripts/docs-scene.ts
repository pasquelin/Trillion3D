/** Regenerate the original scene and compile its published cache using this checkout. */
import { resolve } from 'node:path';
import { writeGarden } from './docs/garden-source.ts';
import { spawnSync } from 'node:child_process';
const root = resolve(import.meta.dirname, '..');
const scene = resolve(root, 'site/assets/kinetic-garden');
await writeGarden(resolve(scene, 'source'));
const executable =
  process.env.TRILLION3D_COMPILER ??
  resolve(root, 'packages/asset-compiler-rust/target/release/trillion3d-compiler');
const result = spawnSync(
  executable,
  ['source/garden.gltf', 'cache', 'full', '150000', '2', '256', '../../../../source/', 'none'],
  // Relative paths from the scene folder: the compiler records the paths it is given.
  { cwd: scene, stdio: 'inherit' },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
