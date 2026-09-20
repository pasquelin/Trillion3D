/** Regenerate the original scene and compile its published cache using this checkout. */
import { resolve } from 'node:path';
import { writeGarden } from './docs/garden-source.mjs';
import { spawnSync } from 'node:child_process';
const root = resolve(import.meta.dirname, '..');
const scene = resolve(root, 'docs/assets/kinetic-garden');
await writeGarden(resolve(scene, 'source'));
const executable =
  process.env.WG_COMPILER ??
  resolve(root, 'packages/asset-compiler-rust/target/release/web-geometry-compiler');
const result = spawnSync(
  executable,
  [
    resolve(scene, 'source/garden.gltf'),
    resolve(scene, 'cache'),
    'full',
    '150000',
    '2',
    '256',
    '../../../../source/',
    'none',
  ],
  { stdio: 'inherit' },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
