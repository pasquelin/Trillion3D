/** Builds the whole site into `dist/site/`: styles, engine runtime, demo maths, portal, statics.
 *
 *   node scripts/docs-build.mjs              writes dist/site/
 *   node scripts/docs-build.mjs --untracked  fails when git tracks any file of it
 *
 * Nothing built is committed: every consumer builds the tree on demand and the Pages workflow
 * builds it from main at deploy (docs/LEARNING_PORTAL.md).
 */
import { buildSite, trackedOutput } from './docs/site.mjs';

if (!process.argv.includes('--untracked')) await buildSite();
else {
  const tracked = trackedOutput();
  if (tracked.length) {
    console.error(
      `The built site is never tracked:\n${tracked.map((file) => `  ${file}`).join('\n')}`,
    );
    process.exit(1);
  }
  console.log('No file of the built site is tracked.');
}
