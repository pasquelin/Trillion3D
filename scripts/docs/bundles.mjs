/** The published bundles: everything `build:docs` writes under docs/, tracked on main only. */
import { execFileSync } from 'node:child_process';
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

/** The bundles whose content read by `actual` is absent or differs from the fresh tree. */
export async function staleBundles(fresh, actual) {
  const stale = [];
  for (const bundle of BUNDLES) {
    const expected = await readFile(join(fresh, bundle));
    const found = await actual(bundle);
    if (found === null || !expected.equals(found)) stale.push(bundle);
  }
  return stale;
}

/** Reads a bundle from a docs/-shaped tree; null when it is missing. */
export const treeReader = (docs) => (bundle) => readFile(join(docs, bundle)).catch(() => null);

/** Reads a bundle as HEAD tracks it, whatever the working tree holds; null when untracked. */
const headReader = (root) => (bundle) => {
  try {
    return execFileSync('git', ['show', `HEAD:docs/${bundle}`], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return null;
  }
};

/** Builds into a temporary tree and names the bundles HEAD tracks stale, or does not track. */
export async function checkBundles(root) {
  const fresh = await mkdtemp(join(tmpdir(), 'wg-docs-build-'));
  try {
    await buildDocs(root, fresh);
    return await staleBundles(fresh, headReader(root));
  } finally {
    await rm(fresh, { recursive: true, force: true });
  }
}

/** The bundles HEAD tracks: none on develop, all of them on main. */
export function trackedBundles(root) {
  const paths = BUNDLES.map((bundle) => `docs/${bundle}`);
  return gitPathsSync(['ls-tree', '--name-only', '-z', 'HEAD', '--', ...paths], root);
}
