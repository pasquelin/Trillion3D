// The manifest of a compiled cache — pointer, root, pages and their column files — decoded whole,
// and the directory its files live in.
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { readPagedManifest } from '../../../packages/sdk-core/src/manifest/paged.ts'
import { readJson } from '../../../scripts/repository-files.ts'

/** The pointer `manifest.json`, naming the root `clusters.json` to read next to it. */
interface ManifestPointer {
  url: string
}

/** `full` is `<cache>/native/full`, the directory of the pointer `manifest.json`. */
export async function readCacheManifest(full: string) {
  const pointer = readJson(join(full, 'manifest.json')) as ManifestPointer
  const rootPath = join(full, pointer.url),
    dir = dirname(rootPath)
  const root = readJson(rootPath) as Record<string, unknown>
  return { dir, manifest: await readPagedManifest(root, (page) => readFile(join(dir, page.url))) }
}

/** True when the cache under `full` holds a transparent primitive (`clustered-blend`), read
 *  through its pages: the root `clusters.json` itself lists no primitive. */
export async function cacheHoldsBlend(full: string) {
  const { manifest } = await readCacheManifest(full)
  return manifest.primitives.some((primitive) => primitive.pass === 'clustered-blend')
}
