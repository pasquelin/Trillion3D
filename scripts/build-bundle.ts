#!/usr/bin/env node
// The CDN bundle, a step of `pnpm run build` after the `tsc` output it bundles: the browser entry
// as one minified ES module, `dist/trillion3d.module.js`, with its source map. Beside it, at the
// root of `dist/`, what it starts or fetches by its own URL (`besideModule`, `import.meta.url`):
// the three workers, each one standalone module, the WebAssembly modules, and the optional
// families' chunks, fetched on first use (`bundle-fold.ts`). A page loads it with one import.
import {
  copyFileSync,
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, type BuildOptions } from 'esbuild';
import { CHUNK_PREFIX, foldPlugin } from './bundle-fold.ts';
import { BUNDLE_SOURCES, bundleSources } from './core-sources.ts';

/** The core module a page imports. */
export const BUNDLE_ENTRY = 'trillion3d.module.js';

const WORKERS = [
  'sdk-browser/src/page/decode/pageDecodeWorker.js',
  'sdk-browser/src/page/integration/pageIntegrationWorker.js',
  'sdk-browser/src/physics/physicsWorker.js',
];
const MODULES = [
  'sdk-browser/src/page/decode/pageCodec.wasm',
  'sdk-browser/src/physics/joltPhysics.wasm',
  'sdk-browser/src/physics/joltPhysicsThreads.wasm',
];

/** Whether `name`, a file at the root of `dist/`, is one this step writes. */
const written = (name: string) =>
  name.startsWith(CHUNK_PREFIX) ||
  name.startsWith(BUNDLE_ENTRY) ||
  [...WORKERS, ...MODULES].some((path) => name.startsWith(basename(path)));

/** Removes an earlier build's bundle, before the build fingerprints `dist/`
 *  (`write-build-provenance.ts`), which describes the unbundled modules alone. */
export function cleanBundle(dist: string) {
  if (!existsSync(dist)) return;
  for (const entry of readdirSync(dist, { withFileTypes: true }))
    if (entry.isFile() && written(entry.name)) rmSync(join(dist, entry.name));
}

/**
 * `source`, a minified bundle file, without the comment lines of its shader texts (WGSL, GLSL),
 * the one place a line of minified code starts: the shader compiler never reads them, so the
 * device builds the very same program, and a page downloads none of them. A line holding a
 * backtick, a `$` or a backslash (an escape, which may be a line break), starting `//#` (the
 * source map's URL) or `//!`, ending a block comment it may sit in, or naming a licence is kept.
 * Every line keeps its place: the source map stays true.
 */
const SHADER_COMMENT_LINE =
  /\n[ \t]*\/\/(?![#!]|[^\n]*(?:@license|@preserve|\*\/))[^\n`$\\]*(?=\n)/g;
export const stripShaderComments = (source: string) => source.replace(SHADER_COMMENT_LINE, '\n');

/** Run by `build.ts` after `cleanBundle`, which the build provenance needs first. */
async function buildBundle(dist: string) {
  const common: BuildOptions = {
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    minify: true,
    sourcemap: true,
    outdir: dist,
    logLevel: 'warning',
  };
  const [core] = await Promise.all([
    build({
      ...common,
      entryPoints: { [BUNDLE_ENTRY.replace(/\.js$/, '')]: join(dist, 'sdk/browser.js') },
      splitting: true,
      chunkNames: `${CHUNK_PREFIX}[name]-[hash]`,
      plugins: [foldPlugin(dist)],
      metafile: true, // the sources of each file, which the size gate lists (`core-sources.ts`)
    }),
    // A worker runs alone: nothing it holds is shared with the page's module.
    build({
      ...common,
      entryNames: '[name]',
      entryPoints: WORKERS.map((path) => join(dist, path)),
    }),
  ]);
  for (const name of readdirSync(dist))
    if (name.endsWith('.js') && written(name)) {
      const path = join(dist, name);
      writeFileSync(path, stripShaderComments(readFileSync(path, 'utf8')));
    }
  for (const path of MODULES) copyFileSync(join(dist, path), join(dist, basename(path)));
  writeFileSync(join(dist, BUNDLE_SOURCES), JSON.stringify(bundleSources(core.metafile, dist)));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await buildBundle(resolve('dist'));
