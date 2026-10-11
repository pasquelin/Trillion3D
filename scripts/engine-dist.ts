// Where `tsc -p tsconfig.json` emits each engine source, read from that file: the witness build
// (`build-witnesses.ts`) points its engine imports there, so it runs the engine the build made.
import { relative, resolve } from 'node:path'
import { REPOSITORY_ROOT, readJson } from './repository-files.ts'

const { compilerOptions } = readJson(resolve(REPOSITORY_ROOT, 'tsconfig.json')) as {
  compilerOptions: { rootDir: string; outDir: string }
}
const rootDir = resolve(REPOSITORY_ROOT, compilerOptions.rootDir)
/** The build output `dist/`, absolute. */
export const outDir = resolve(REPOSITORY_ROOT, compilerOptions.outDir)

/** The file `tsc` emits for the engine source `source`, both absolute paths. */
export const emittedOf = (source: string) =>
  resolve(outDir, relative(rootDir, source))
    .replace(/\.ts$/, '.js')
    .replace(/\.mts$/, '.mjs')
