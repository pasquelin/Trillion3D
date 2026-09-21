import { canonicalizeFossilCache } from './docs/fossil-excavation/canonical.mjs';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fossilExcavation } from './docs/fossil-excavation/scene.mjs';
import { writeFossilExcavation } from './docs/fossil-excavation/write.mjs';

const root = resolve(import.meta.dirname, '..'),
  directory = resolve(root, 'site/assets/gallery/fossil-excavation'),
  compiler =
    process.env.WG_COMPILER ??
    resolve(root, 'packages/asset-compiler-rust/target/release/web-geometry-compiler');
await writeFossilExcavation(resolve(directory, 'source'), fossilExcavation());
if (process.argv.includes('--source-only')) process.exit(0);
await rm(resolve(directory, 'cache'), { recursive: true, force: true });
const result = spawnSync(
  compiler,
  [
    resolve(directory, 'source/excavation.obj'),
    resolve(directory, 'cache'),
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
if (result.status !== 0) throw new Error('Fossil excavation compilation failed');
await rm(resolve(directory, 'cache/native/.lock'), { force: true });

await canonicalizeFossilCache(resolve(directory, 'cache'));
