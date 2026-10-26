// The manifest of a compiled cache — pointer, root, pages and their column files — decoded whole,
// and the directory its files live in.
import { dirname, join } from 'node:path'
import { readCompiledManifest } from '../../../packages/sdk-node/src/compiler/manifest.mts'
import { readJson } from '../../../scripts/git/repository-files.ts'

/** The pointer `manifest.json`, naming the root `clusters.json` to read next to it. */
interface ManifestPointer {
  url: string
}

/** `full` is `<cache>/native/full`, the directory of the pointer `manifest.json`. */
export async function readCacheManifest(full: string) {
  const pointer = readJson(join(full, 'manifest.json')) as ManifestPointer
  const rootPath = join(full, pointer.url)
  return { dir: dirname(rootPath), manifest: await readCompiledManifest(rootPath) }
}

/** True when the cache under `full` holds a transparent primitive (`clustered-blend`), read
 *  through its pages: the root `clusters.json` itself lists no primitive. */
export async function cacheHoldsBlend(full: string) {
  const { manifest } = await readCacheManifest(full)
  return manifest.primitives.some((primitive) => primitive.pass === 'clustered-blend')
}
