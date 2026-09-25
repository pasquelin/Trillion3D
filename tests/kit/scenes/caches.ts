import { existsSync } from 'node:fs';
import { glob } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Mount } from '../../../scripts/static-server.ts';

/** The folders whose scenes keep a compiled cache beside their committed source, which git never
 *  tracks (`scripts/site-caches.ts` compiles them, `.gitignore` names them). */
export const SCENE_ROOTS = ['site/assets', 'tests/fixtures/scenes'] as const;

/** Every scene root served at its own path, so the URL a proof opens a scene by is the scene's
 *  path in the repository, wherever the scene lives. */
export const sceneMounts = (root: string): Mount[] =>
  SCENE_ROOTS.map((folder) => ({ prefix: `/${folder}/`, dir: resolve(root, folder) }));

/** `file` in every compiled scene cache, relative to the repository root; a cache whose scene has
 *  no source any more, left on disk by a scene removed since, is not read. */
export async function sceneCacheFiles(file: string): Promise<string[]> {
  const cwd = fileURLToPath(new URL('../../../', import.meta.url));
  const found: string[] = [];
  const patterns = SCENE_ROOTS.map((folder) => `${folder}/**/cache/native/full/${file}`);
  for await (const path of glob(patterns, { cwd }))
    if (existsSync(join(cwd, path.split('/cache/')[0], 'source'))) found.push(path);
  return found;
}
