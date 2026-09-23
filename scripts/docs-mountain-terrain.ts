import { rm } from 'node:fs/promises';
import { compileGalleryScene } from './docs/gallery-scene.ts';
import { resolve } from 'node:path';
import { mountainTerrain } from './docs/mountain-terrain/model.ts';
import { writeMountainTerrain } from './docs/mountain-terrain/write.ts';
const root = resolve(import.meta.dirname, '..'),
  directory = resolve(root, 'site/assets/gallery/offline/terrain');
await rm(resolve(directory, 'source'), { recursive: true, force: true });
await writeMountainTerrain(resolve(directory, 'source'), mountainTerrain());
if (process.argv.includes('--source-only')) process.exit(0);
await rm(resolve(directory, 'cache'), { recursive: true, force: true });
const status = compileGalleryScene(root, directory, 'qem-endpoints');
if (status !== 0) throw new Error('Mountain terrain compilation failed');
await rm(resolve(directory, 'cache/native/.lock'), { force: true });
