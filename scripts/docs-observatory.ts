import { resolve } from 'node:path';
import { rm } from 'node:fs/promises';
import { compileGalleryScene } from './docs/gallery-scene.ts';
import { writeObservatory } from './docs/observatory/write.ts';

const root = resolve(import.meta.dirname, '..');
const destination = resolve(root, 'site/assets/gallery/signature-architecture');
await writeObservatory(resolve(destination, 'source'));
if (!process.argv.includes('--source-only')) {
  const status = compileGalleryScene(root, destination, 'qem-endpoints');
  if (status !== 0) throw new Error(`Observatory compilation failed: ${status}`);
  await rm(resolve(destination, 'cache/native/.lock'), { force: true });
}
