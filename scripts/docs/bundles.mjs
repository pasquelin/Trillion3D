/** The generated bundles: everything `build:docs` writes under docs/, never tracked by git. */
import { resolve } from 'node:path';
import { gitPathsSync } from '../git-paths.mjs';
import { buildDemo } from './build-demo.mjs';
import { buildPortal } from './build-portal.mjs';
import { buildRuntime } from './build-runtime.mjs';
import { buildStyles } from './build-styles.mjs';

/** Paths relative to docs/. */
export const BUNDLES = [
  'css/site.css',
  'js/engine.js',
  'runtime/engine.js',
  'runtime/pageCodec.wasm',
  'runtime/pageDecodeWorker.js',
  'runtime/pageIntegrationWorker.js',
  'runtime/portal.js',
];

/** Builds the styles, demo module, browser engine, workers and portal into a docs/-shaped tree. */
export async function buildDocs(root, docs = resolve(root, 'docs')) {
  await buildStyles(root, resolve(docs, 'css/site.css'));
  await buildDemo(root, resolve(docs, 'js/engine.js'));
  await buildRuntime(root, resolve(docs, 'runtime'));
  await buildPortal(root, resolve(docs, 'runtime'));
}

/** The handwritten docs modules import `docs/js/engine.js`: a test runner builds it before they load. */
export const buildDemoModule = (root) => buildDemo(root, resolve(root, 'docs/js/engine.js'));

/** The bundles git tracks: always none, since Pages builds them from the sources at deploy. */
export function trackedBundles(root) {
  const paths = BUNDLES.map((bundle) => `docs/${bundle}`);
  return gitPathsSync(['ls-files', '-z', '--', ...paths], root);
}
