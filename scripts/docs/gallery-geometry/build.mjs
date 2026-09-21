import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { geometryRecipes } from '../../../site/lessons/offline/recipes.ts';
import { writeGeometry } from './write-gltf.mjs';
const root = resolve(import.meta.dirname, '../../..');
const compiler =
  process.env.WG_COMPILER ??
  resolve(root, 'packages/asset-compiler-rust/target/release/web-geometry-compiler');
for (const recipe of geometryRecipes) {
  if (process.argv[2] && recipe.id !== process.argv[2]) continue;
  const directory = resolve(root, 'site/assets/gallery/offline', recipe.id);
  await writeGeometry(resolve(directory, 'source'), recipe.create());
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
      recipe.id === 'terrain' ? 'qem-endpoints' : 'none',
    ],
    { stdio: 'inherit' },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Compilation failed for ${recipe.id}`);
  await rm(resolve(directory, 'cache/native/.lock'), { force: true });
}
