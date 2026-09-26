// Where `tsc -p tsconfig.json` emits each engine source, read from that file: the witness build
// (`build-witnesses.ts`) points its engine imports there, and a repository page
// (`tests/kit/server/repoPage.ts`) resolves its own there, so each runs the engine the build made.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const { compilerOptions } = JSON.parse(readFileSync(resolve(ROOT, 'tsconfig.json'), 'utf8')) as {
  compilerOptions: { rootDir: string; outDir: string };
};
const rootDir = resolve(ROOT, compilerOptions.rootDir);
const outDir = resolve(ROOT, compilerOptions.outDir);

/** The file `tsc` emits for the engine source `source`, both absolute paths. */
export const emittedOf = (source: string) =>
  resolve(outDir, relative(rootDir, source))
    .replace(/\.ts$/, '.js')
    .replace(/\.mts$/, '.mjs');

/** Every engine source under a folder of `packages/` the build emitted to (the `include` folders,
 *  and those their imports reach, such as `page-codec`), less tests, fixtures and declarations. */
export function engineSources(): string[] {
  const folders = readdirSync(outDir).filter((name) => existsSync(resolve(rootDir, name)));
  return folders.flatMap((name) =>
    readdirSync(resolve(rootDir, name), { recursive: true, encoding: 'utf8' })
      .filter((file) => /\.m?ts$/.test(file) && !/\.(test|fixture|d)\.ts$/.test(file))
      .map((file) => resolve(rootDir, name, file)),
  );
}
