import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { readPagedManifest } from '../../../sdk-core/src/manifest/paged.ts'

/**
 * The compiled manifest whose root file is `path`, read through its pages (`readPagedManifest`),
 * each page beside the root. The one reader of a compiled manifest on disk.
 */
export async function readCompiledManifest(path: string) {
  const root = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
  return readPagedManifest(root, (page) => readFile(join(dirname(path), page.url)))
}
