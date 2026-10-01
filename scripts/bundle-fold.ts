import { readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import type { Plugin } from 'esbuild';

/** The CDN bundle's chunks, each named after the module it holds: `trillion3d-<module>-<hash>.js`. */
export const CHUNK_PREFIX = 'trillion3d-';

/** The modules that stay chunks of their own in the CDN bundle, fetched on first use: the optional
 *  families, each one module (`sdk-browser/src/host/families.ts`) — a family of several would
 *  share code with the core in as many more chunks. Physics, whose session starts its worker and
 *  its WebAssembly; particles; WebGPU transmission, glass and water; WebGPU
 *  deformation; the effect chain; the guides; the diagnostic views; the measurement's build
 *  provenance and comparison compositor; the world pages' server; the WebGPU impostor draw. A scene that uses none of them
 *  fetches none. */
export const FAMILY_MODULES = {
  physics: ['sdk-browser/src/physics/session.js'],
  particles: ['sdk-browser/src/particles/particleCode.js'],
  transmission: ['sdk-browser/src/webgpu/water/transmissionCode.js'],
  deformation: ['sdk-browser/src/deformation/deformationCode.js'],
  effects: ['sdk-browser/src/effects/effectCode.js'],
  guides: ['sdk-browser/src/guides/guideCode.js'],
  diagnostics: ['sdk-browser/src/diagnostic/viewCode.js'],
  measurement: ['sdk-browser/src/measurement/measurementCode.js'],
  worldStream: ['sdk-browser/src/scene/worldPageServe.js'],
  impostors: ['sdk-browser/src/webgpu/impostor/impostorCode.js'],
};
export type Family = keyof typeof FAMILY_MODULES;

/** The chunk of each module of `family` in the bundle at `dist`, `undefined` where the build made
 *  none: a module the core imports statically is folded into it. */
export function familyChunks(dist: string, family: Family) {
  const files = readdirSync(dist);
  return FAMILY_MODULES[family].map((path) => {
    const name = `${CHUNK_PREFIX}${basename(path, '.js')}-`;
    const chunk = files.find(
      (file) => file.startsWith(name) && /^[A-Z0-9]+\.js$/.test(file.slice(name.length)),
    );
    return { module: basename(path, '.js'), chunk };
  });
}

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
  const families = Object.values(FAMILY_MODULES)
    .flat()
    .map((path) => resolve(root, path));
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
