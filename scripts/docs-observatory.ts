import { resolve } from 'node:path';
import { rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { writeObservatory } from './docs/observatory/write.ts';

const root = resolve(import.meta.dirname, '..');
const destination = resolve(root, 'site/assets/gallery/signature-architecture');
await writeObservatory(resolve(destination, 'source'));
if (!process.argv.includes('--source-only')) {
  const compiler =
    process.env.WG_COMPILER ??
    resolve(root, 'packages/asset-compiler-rust/target/release/web-geometry-compiler');
  const result = spawnSync(
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
  if (result.status !== 0) throw new Error(`Observatory compilation failed: ${result.status}`);
  await rm(resolve(destination, 'cache/native/.lock'), { force: true });
}
