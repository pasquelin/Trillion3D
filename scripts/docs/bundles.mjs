/** The generated bundles: everything `build:docs` writes under docs/, never tracked by git. */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
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

/** Builds the styles, the demo maths, the browser engine, its workers and the portal into a docs/-shaped tree. */
export async function buildDocs(root, docs = resolve(root, 'docs')) {
  await buildStyles(root, resolve(docs, 'css/site.css'));
  await buildDemo(root, resolve(docs, 'js/engine.js'));
  await buildRuntime(root, resolve(docs, 'runtime'));
  await buildPortal(root, resolve(docs, 'runtime'));
}

/** Builds the demo bundle alone into a temporary tree for a test that imports it; `remove` deletes it. */
export async function temporaryDemoBundle(root) {
  const directory = await mkdtemp(join(tmpdir(), 'wg-docs-demo-'));
  const file = join(directory, 'engine.js');
  await buildDemo(root, file);
  return {
    url: pathToFileURL(file).href,
    remove: () => rm(directory, { recursive: true, force: true }),
  };
}

/** The bundles git tracks: always none, since Pages builds them from the sources at deploy. */
export function trackedBundles(root) {
  const paths = BUNDLES.map((bundle) => `docs/${bundle}`);
  return gitPathsSync(['ls-files', '-z', '--', ...paths], root);
}
