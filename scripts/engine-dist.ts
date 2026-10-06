// Where `tsc -p tsconfig.json` emits each engine source, read from that file: the witness build
// (`build-witnesses.ts`) points its engine imports there, so it runs the engine the build made.
import { readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const { compilerOptions } = JSON.parse(readFileSync(resolve(ROOT, 'tsconfig.json'), 'utf8')) as {
  compilerOptions: { rootDir: string; outDir: string }
}
const rootDir = resolve(ROOT, compilerOptions.rootDir)
/** The build output `dist/`, absolute. */
export const outDir = resolve(ROOT, compilerOptions.outDir)

/** The file `tsc` emits for the engine source `source`, both absolute paths. */
export const emittedOf = (source: string) =>
  resolve(outDir, relative(rootDir, source))
    .replace(/\.ts$/, '.js')
    .replace(/\.mts$/, '.mjs')
