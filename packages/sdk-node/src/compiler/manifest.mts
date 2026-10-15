import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { readPagedManifest } from '../../../sdk-core/src/manifest/paged.ts'

/**
 * The compiled manifest whose root file is `path`, read through its pages (`readPagedManifest`),
 * each page beside the root; `headOnly` reads the head page's columns alone, no mesh page. The one
 * reader of a compiled manifest on disk: a finished compile's and the cutout thumbnails'.
 */
export async function readCompiledManifest(path: string, headOnly = false) {
  const root = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
  return readPagedManifest(headOnly ? { ...root, pages: [] } : root, (page) =>
    readFile(join(dirname(path), page.url)),
  )
}
