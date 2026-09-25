import { existsSync } from 'node:fs';
import { glob } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Mount } from '../../../scripts/static-server.ts';

/** The folders whose scenes keep a compiled cache beside their committed source, which git never
 *  tracks (`scripts/site-caches.ts` compiles them, `.gitignore` names them). */
export const SCENE_ROOTS = ['site/assets', 'tests/fixtures/scenes'] as const;

const REPOSITORY = fileURLToPath(new URL('../../../', import.meta.url));

/** Whether `folder`, relative to the repository root, is a scene under a scene root whose source
 *  is committed: it holds a `source/`. */
const hasSource = (folder: string) =>
  SCENE_ROOTS.some((sceneRoot) => folder.startsWith(`${sceneRoot}/`)) &&
  existsSync(join(REPOSITORY, folder, 'source'));

/** The URL `sceneMounts` serve the compiled full manifest of `scene`, a scene folder relative to
 *  the repository root, at; a folder that is no scene with a source throws. */
export function manifestUrlOf(scene: string): string {
  if (!hasSource(scene)) throw new Error(`${scene}: no scene with a source under ${SCENE_ROOTS}`);
  return `/${scene}/cache/native/full/manifest.json`;
}

/** Every scene root served at its own path, so the URL a proof opens a scene by is the scene's
 *  path in the repository, wherever the scene lives. */
export const sceneMounts = (root: string): Mount[] =>
  SCENE_ROOTS.map((folder) => ({ prefix: `/${folder}/`, dir: resolve(root, folder) }));

/** `file` in every compiled scene cache, relative to the repository root; a cache whose scene has
 *  no source any more, left on disk by a scene removed since, is not read. */
export async function sceneCacheFiles(file: string): Promise<string[]> {
  const found: string[] = [];
  // `cache`, or `cache-<name>` for a second cook of the same source (`site-caches.ts`).
  const patterns = SCENE_ROOTS.map((folder) => `${folder}/**/cache{,-*}/native/full/${file}`);
  for await (const path of glob(patterns, { cwd: REPOSITORY }))
    if (hasSource(path.replace(/\/cache(-[^/]+)?\/native\/full\/.*$/, ''))) found.push(path);
  return found;
}
