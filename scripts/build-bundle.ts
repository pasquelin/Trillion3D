#!/usr/bin/env node
// The CDN bundle, a step of `pnpm run build` after the `tsc` output it bundles: the browser entry
// as one minified ES module, `dist/trillion3d.module.js`, with its source map. Beside it, at the
// root of `dist/`, what it starts or fetches by its own URL (`besideModule`, `import.meta.url`):
// the three workers, each one standalone module, the WebAssembly modules, and the optional
// families' chunks, fetched on first use (`bundle-fold.ts`). A page loads it with one import.
import { copyFileSync, readdirSync, rmSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, type BuildOptions } from 'esbuild';
import { foldPlugin } from './bundle-fold.ts';

/** The core module a page imports. */
export const BUNDLE_ENTRY = 'trillion3d.module.js';
/** The chunks of the optional families, named after the module that loads them. */
const CHUNK_PREFIX = 'trillion3d-';

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
  for (const entry of readdirSync(dist, { withFileTypes: true }))
    if (entry.isFile() && written(entry.name)) rmSync(join(dist, entry.name));
}

async function buildBundle(dist: string) {
  cleanBundle(dist);
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
  await build({
    ...common,
    entryPoints: { [BUNDLE_ENTRY.replace(/\.js$/, '')]: join(dist, 'sdk/browser.js') },
    splitting: true,
    chunkNames: `${CHUNK_PREFIX}[name]-[hash]`,
    plugins: [foldPlugin(dist)],
  });
  // A worker runs alone: nothing it holds is shared with the page's module.
  await build({
    ...common,
    entryNames: '[name]',
    entryPoints: WORKERS.map((path) => join(dist, path)),
  });
  for (const path of MODULES) copyFileSync(join(dist, path), join(dist, basename(path)));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await buildBundle(resolve('dist'));
