/** Regenerate the original scene and compile its published cache using this checkout. */
import { resolve } from 'node:path';
import { writeGarden } from './docs/garden-source.ts';
import { compileFullCache } from './native-compiler.ts';
const scene = resolve(import.meta.dirname, '../site/assets/kinetic-garden');
await writeGarden(resolve(scene, 'source'));
compileFullCache({ cwd: scene, source: 'source/garden.gltf' });
