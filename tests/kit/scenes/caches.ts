import { existsSync } from 'node:fs';
import { glob } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The folders whose scenes keep a compiled cache beside their committed source, which git never
 *  tracks (`scripts/site-caches.ts` compiles them, `.gitignore` names them). */
export const SCENE_ROOTS = ['site/assets', 'tests/fixtures/scenes'] as const;

/** `file` in every compiled scene cache, relative to the repository root; a cache whose scene has
 *  no source any more, left on disk by a scene removed since, is not read. */
export async function sceneCacheFiles(file: string): Promise<string[]> {
  const cwd = fileURLToPath(new URL('../../../', import.meta.url));
  const found: string[] = [];
  // `cache`, or `cache-<name>` for a second cook of the same source (`site-caches.ts`).
  const patterns = SCENE_ROOTS.map((folder) => `${folder}/**/cache{,-*}/native/full/${file}`);
  for await (const path of glob(patterns, { cwd }))
    if (existsSync(join(cwd, path.replace(/\/cache(-[^/]+)?\/native\/full\/.*$/, ''), 'source')))
      found.push(path);
  return found;
}
