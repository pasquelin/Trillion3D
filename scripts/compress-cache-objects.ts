/** Pre-compresses a built site's scene-cache objects in brotli beside their originals (`pages.yml`). */
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { availableParallelism } from 'node:os'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { brotliCompress, constants } from 'node:zlib'

/** A scene cache's content-addressed object, geometry pages among them: binary, yet 11 to 24 %
 *  lighter in brotli. The one rule the docs server (`docs/serve.ts`) and the deploy share. */
export const isCacheObject = (file: string) => /[\\/]objects[\\/][^\\/]+\.bin$/.test(file)

const compress = promisify(brotliCompress)

/** Writes `<object>.br` at the top quality beside every cache object under `root`, one file per
 *  core at a time on zlib's thread pool; returns how many it wrote. */
export async function compressCacheObjects(root: string) {
  const files = (await readdir(root, { recursive: true }))
    .map((file) => resolve(root, file))
    .filter(isCacheObject)
  const top = { params: { [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY } }
  let next = 0
  const worker = async () => {
    for (let file; (file = files[next++]) !== undefined;)
      await writeFile(`${file}.br`, await compress(await readFile(file), top))
  }
  await Promise.all(Array.from({ length: availableParallelism() }, worker))
  return files.length
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = process.argv[2] ?? 'dist/site'
  console.log(`${await compressCacheObjects(root)} cache objects compressed under ${root}`)
}
