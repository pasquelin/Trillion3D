import { sha256 } from '../packages/sdk-node/src/compiler/provenance.mts'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve, relative, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { filesUnder, posixPath } from './repository-files.ts'

export async function fingerprintBuild(
  directory: string,
): Promise<{ hash: string; modules: Record<string, string> }> {
  const files = filesUnder(directory).filter(
    (path) =>
      /\.(m?js)$/.test(path) &&
      basename(path) !== 'buildProvenance.js' &&
      !basename(path).includes('.test.'),
  )
  const modules: Record<string, string> = {}
  for (const file of files.sort())
    modules[posixPath(relative(directory, file))] = sha256(await readFile(file))
  return { hash: sha256(JSON.stringify(modules)), modules }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = resolve('dist')
  const provenance = {
    version: 1,
    ...(await fingerprintBuild(directory)),
    generatedAt: new Date().toISOString(),
  }
  await writeFile(
    resolve(directory, 'sdk-browser/src/measurement/buildProvenance.js'),
    `export const SDK_BUILD_PROVENANCE=${JSON.stringify(provenance)};\n`,
  )
}
