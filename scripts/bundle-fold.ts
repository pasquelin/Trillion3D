import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { Plugin } from 'esbuild';

/** The modules that stay chunks of their own in the CDN bundle, fetched on first use: the optional
 *  families. Physics, whose session starts its worker and its WebAssembly (`worldPhysics.ts`). */
const FAMILY_MODULES = ['sdk-browser/src/physics/session.js'];

const DYNAMIC_IMPORT = /\bimport\((["'])(\.{1,2}\/[^"']+)\1\)/g;

/**
 * `source` with every relative `import('…')` whose target `keep` refuses folded into the module: a
 * namespace import appended at the end — import declarations are hoisted, so no line moves and the
 * source map stays true — and the call resolved to it. esbuild makes a chunk of every dynamic
 * import; folded, the engine's own ones (the decoder's fallbacks) stay inside the core module.
 */
export function foldDynamicImports(source: string, keep: (specifier: string) => boolean): string {
  const hoisted: string[] = [];
  const body = source.replace(DYNAMIC_IMPORT, (call, _quote: string, specifier: string) => {
    if (keep(specifier)) return call;
    const name = `__folded${hoisted.length}`;
    hoisted.push(`import * as ${name} from ${JSON.stringify(specifier)};`);
    return `Promise.resolve(${name})`;
  });
  return hoisted.length ? `${body}\n${hoisted.join('\n')}\n` : body;
}

/** The esbuild plugin folding every dynamic import under `root` but the families'. */
export function foldPlugin(root: string): Plugin {
  const families = FAMILY_MODULES.map((path) => resolve(root, path));
  return {
    name: 'fold-dynamic-imports',
    setup(build) {
      build.onLoad({ filter: /\.js$/ }, async ({ path }) => ({
        contents: foldDynamicImports(await readFile(path, 'utf8'), (specifier) =>
          families.includes(resolve(dirname(path), specifier)),
        ),
        loader: 'js',
      }));
    },
  };
}
