import { resolve } from 'node:path';
import { rm } from 'node:fs/promises';
import { compileGalleryScene } from './docs/gallery-scene.ts';
import { writeShadowTheatre } from './docs/shadow-theatre/write.ts';

const root = resolve(import.meta.dirname, '..'),
  destination = resolve(root, 'site/assets/gallery/shadow-theatre');
await writeShadowTheatre(resolve(destination, 'source'));
if (!process.argv.includes('--source-only')) {
  const status = compileGalleryScene(root, destination, 'qem-endpoints');
  if (status !== 0) throw new Error(`Shadow theatre compilation failed: ${status}`);
  await rm(resolve(destination, 'cache/native/.lock'), { force: true });
}
