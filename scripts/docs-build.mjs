/** Reproducible styles, demo maths, engine modules and portal for the static learning portal.
 *
 *   node scripts/docs-build.mjs              writes the bundles under docs/
 *   node scripts/docs-build.mjs --untracked  fails when git tracks any of them
 *
 * The bundles are never committed: every consumer builds them on demand and the Pages workflow
 * builds them from main at deploy (docs/LEARNING_PORTAL.md).
 */
import { resolve } from 'node:path';
import { buildDocs, trackedBundles } from './docs/bundles.mjs';

const root = resolve(import.meta.dirname, '..');
if (!process.argv.includes('--untracked')) await buildDocs(root);
else {
  const tracked = trackedBundles(root);
  if (tracked.length) {
    console.error(
      `Generated bundles are never tracked:\n${tracked.map((file) => `  ${file}`).join('\n')}`,
    );
    process.exit(1);
  }
  console.log('No generated bundle is tracked.');
}
