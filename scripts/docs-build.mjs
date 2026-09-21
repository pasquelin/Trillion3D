/** Reproducible styles, engine modules and portal for the static learning portal.
 *
 *   node scripts/docs-build.mjs           writes docs/css/site.css and docs/runtime/
 *   node scripts/docs-build.mjs --check   fails when the tracked bundles differ from a fresh build
 *
 * The bundles are not committed on develop: the release commits them on main (see
 * docs/LEARNING_PORTAL.md), so `--check` has nothing to compare where git tracks none of them.
 */
import { resolve } from 'node:path';
import { buildDocs, checkBundles, trackedBundles } from './docs/bundles.mjs';

const root = resolve(import.meta.dirname, '..');
if (!process.argv.includes('--check')) await buildDocs(root);
else if (!trackedBundles(root).length)
  console.log('No published bundle is tracked in this tree: nothing to compare.');
else {
  const stale = await checkBundles(root);
  if (stale.length) {
    console.error(
      `Published bundles stale or missing:\n${stale.map((bundle) => `  docs/${bundle}`).join('\n')}\n` +
        'Run pnpm run build:docs and commit them on the release branch.',
    );
    process.exit(1);
  }
  console.log('Published bundles match the sources.');
}
