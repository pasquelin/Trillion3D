/** The published bundles: everything `build:docs` writes under docs/, tracked on main only. */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { gitPathsSync } from '../git-paths.mjs';
import { buildPortal } from './build-portal.mjs';
import { buildRuntime } from './build-runtime.mjs';
import { buildStyles } from './build-styles.mjs';

/** Paths relative to docs/. */
export const BUNDLES = [
  'css/site.css',
  'runtime/engine.js',
  'runtime/highlighter.js',
  'runtime/pageCodec.wasm',
  'runtime/pageDecodeWorker.js',
  'runtime/pageIntegrationWorker.js',
  'runtime/portal.js',
];

/** Builds the styles, the browser engine, its workers and the portal into a docs/-shaped tree. */
export async function buildDocs(root, docs = resolve(root, 'docs')) {
  await buildStyles(root, { output: resolve(docs, 'css/site.css') });
  await buildRuntime(root, resolve(docs, 'runtime'));
  await buildPortal(root, resolve(docs, 'runtime'));
}

/** The bundles of `docs` that are missing or differ from the freshly built `fresh` tree. */
export async function staleBundles(fresh, docs) {
  const stale = [];
  for (const bundle of BUNDLES) {
    const expected = await readFile(join(fresh, bundle));
    const actual = await readFile(join(docs, bundle)).catch(() => null);
    if (actual === null || !expected.equals(actual)) stale.push(bundle);
  }
  return stale;
}

/** Builds into a temporary tree and names the bundles of docs/ that are stale or missing. */
export async function checkBundles(root) {
  const fresh = await mkdtemp(join(tmpdir(), 'wg-docs-build-'));
  try {
    await buildDocs(root, fresh);
    return await staleBundles(fresh, resolve(root, 'docs'));
  } finally {
    await rm(fresh, { recursive: true, force: true });
  }
}

/** The bundles git tracks in this tree: none on develop, all of them on main. */
export function trackedBundles(root) {
  return gitPathsSync(['ls-files', '-z', '--', ...BUNDLES.map((bundle) => `docs/${bundle}`)], root);
}
