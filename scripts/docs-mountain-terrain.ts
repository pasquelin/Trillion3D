import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { mountainTerrain } from './docs/mountain-terrain/model.ts';
import { writeMountainTerrain } from './docs/mountain-terrain/write.ts';
const root = resolve(import.meta.dirname, '..'),
  directory = resolve(root, 'site/assets/gallery/offline/terrain'),
  compiler =
    process.env.WG_COMPILER ??
    resolve(root, 'packages/asset-compiler-rust/target/release/web-geometry-compiler');
await rm(resolve(directory, 'source'), { recursive: true, force: true });
await writeMountainTerrain(resolve(directory, 'source'), mountainTerrain());
if (process.argv.includes('--source-only')) process.exit(0);
await rm(resolve(directory, 'cache'), { recursive: true, force: true });
const result = spawnSync(
  compiler,
  [
    resolve(directory, 'source/geometry.gltf'),
    resolve(directory, 'cache'),
    'full',
    '150000',
    '2',
    '256',
    '../../../../source/',
    'qem-endpoints',
  ],
  { stdio: 'inherit' },
);
if (result.error) throw result.error;
if (result.status !== 0) throw new Error('Mountain terrain compilation failed');
await rm(resolve(directory, 'cache/native/.lock'), { force: true });
