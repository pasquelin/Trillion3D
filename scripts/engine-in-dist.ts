// Where the build puts each engine source: the one mapping `tsc` applies (`tsconfig.json`'s
// `rootDir`, `outDir` and `rewriteRelativeImportExtensions`), read by the witness bundle and by
// the harness page that loads the engine from `dist/`.
import { relative, resolve, sep } from 'node:path';
import ts from 'typescript';

/** The file `tsc` emits for the engine source at `path`, relative to `packages/`: the same path
 *  relative to `dist/`, `.ts` become `.js` and `.mts` `.mjs`. */
export const emittedFile = (path: string) => path.replace(/\.ts$/, '.js').replace(/\.mts$/, '.mjs');

/**
 * Import-map entries sending each engine source the build emits, by its address under the
 * server's `/packages/` mount, to its emitted file under `/dist/`. A page module that imports
 * engine sources by relative path (the graph fixtures, the maths) then runs the engine the page
 * loads from `dist/`, one instance of each module: two would hold two scene states, whose nodes
 * refuse each other ("Scene nodes belong to different roots", #795). A fixture, which the build
 * leaves out, still runs from its source, on the emitted engine.
 */
export function engineInDist(root: string): Record<string, string> {
  const { config } = ts.readConfigFile(resolve(root, 'tsconfig.json'), ts.sys.readFile);
  const { fileNames, options } = ts.parseJsonConfigFileContent(config, ts.sys, root);
  const packages = options.rootDir!;
  const address = (file: string) => relative(root, file).split(sep).join('/');
  // The program, not the list the config globs: a file those import from elsewhere under
  // `rootDir` is emitted too.
  const program = ts.createProgram({ rootNames: fileNames, options });
  return Object.fromEntries(
    program
      .getSourceFiles()
      .map((source) => resolve(source.fileName))
      .filter((file) => file.startsWith(packages + sep) && !file.endsWith('.d.ts'))
      .map((file) => [
        `/${address(file)}`,
        `/${address(resolve(options.outDir!, emittedFile(relative(packages, file))))}`,
      ]),
  );
}
