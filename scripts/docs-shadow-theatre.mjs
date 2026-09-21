import { resolve } from 'node:path';
import { rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { writeShadowTheatre } from './docs/shadow-theatre/write.mjs';

const root = resolve(import.meta.dirname, '..'),
  destination = resolve(root, 'site/assets/gallery/shadow-theatre');
await writeShadowTheatre(resolve(destination, 'source'));
if (!process.argv.includes('--source-only')) {
  const compiler =
      process.env.WG_COMPILER ??
      resolve(root, 'packages/asset-compiler-rust/target/release/web-geometry-compiler'),
    result = spawnSync(
      compiler,
      [
        resolve(destination, 'source/geometry.gltf'),
        resolve(destination, 'cache'),
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
  if (result.status !== 0) throw new Error(`Shadow theatre compilation failed: ${result.status}`);
  await rm(resolve(destination, 'cache/native/.lock'), { force: true });
}
