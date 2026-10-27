import { existsSync } from 'node:fs'
import { access, glob, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { assertCachePointer } from '../../../packages/sdk-core/src/contracts/cache.ts'
import { REPOSITORY_ROOT } from '../../../scripts/git/repository-files.ts'

/** The folders whose scenes keep a compiled cache beside their committed source, which git never
 *  tracks (`scripts/native/scene-caches.ts` compiles them, `.gitignore` names them). */
export const SCENE_ROOTS = ['tests/fixtures/scenes'] as const

/** Whether `folder`, relative to the repository root, is a scene under a scene root whose source
 *  is committed: it holds a `source/`. */
const hasSource = (folder: string) =>
  SCENE_ROOTS.some((sceneRoot) => folder.startsWith(`${sceneRoot}/`)) &&
  existsSync(join(REPOSITORY_ROOT, folder, 'source'))

/** The repository path of the compiled full manifest of `scene`, a scene folder relative to the
 *  repository root; a folder that is no scene with a source throws. */
export function manifestUrlOf(scene: string): string {
  if (!hasSource(scene)) throw new Error(`${scene}: no scene with a source under ${SCENE_ROOTS}`)
  return `/${scene}/cache/native/full/manifest.json`
}

/** `file` in the current key's folder of every compiled scene cache, relative to the repository root:
 *  the folder the cache's `manifest.json` names (`assertCachePointer`), so a key left on disk by an
 *  earlier cook is never read; a cache whose scene has no source any more, left on disk by a scene
 *  removed since, is not read either, nor is one whose manifest is out of date (to cook again). */
export async function sceneCacheFiles(file: string): Promise<string[]> {
  const found: string[] = []
  // `cache`, or `cache-<name>` for a second cook of the same source (`scene-caches.ts`).
  const patterns = SCENE_ROOTS.map((folder) => `${folder}/**/cache{,-*}/native/full/manifest.json`)
  for await (const manifest of glob(patterns, { cwd: REPOSITORY_ROOT })) {
    if (!hasSource(manifest.replace(/\/cache(-[^/]+)?\/native\/full\/manifest\.json$/, '')))
      continue
    let path: string
    try {
      const pointer: unknown = JSON.parse(await readFile(join(REPOSITORY_ROOT, manifest), 'utf8'))
      path = join(dirname(manifest), dirname(assertCachePointer(pointer, 'full')), file)
    } catch {
      continue
    }
    if (
      await access(join(REPOSITORY_ROOT, path)).then(
        () => true,
        () => false,
      )
    )
      found.push(path)
  }
  return found
}
