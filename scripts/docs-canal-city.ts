import { rm } from 'node:fs/promises';
import { compileGalleryScene } from './docs/gallery-scene.ts';
import { resolve } from 'node:path';
import { canalCity } from './docs/canal-city/model.ts';
import { writeCanalCity } from './docs/canal-city/write.ts';
const root = resolve(import.meta.dirname, '..'),
  directory = resolve(root, 'site/assets/gallery/offline/city');
await rm(resolve(directory, 'source'), { recursive: true, force: true });
await writeCanalCity(resolve(directory, 'source'), canalCity());
if (process.argv.includes('--source-only')) process.exit(0);
await rm(resolve(directory, 'cache'), { recursive: true, force: true });
const status = compileGalleryScene(root, directory, 'none');
if (status !== 0) throw new Error('Canal city compilation failed');
await rm(resolve(directory, 'cache/native/.lock'), { force: true });
