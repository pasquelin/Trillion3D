/** Builds the whole site into `dist/site/`: styles, engine runtime, demo maths, portal, statics.
 *
 *   node scripts/docs-build.ts              writes dist/site/
 *   node scripts/docs-build.ts --published  writes it with the audience measurement, as deployed
 *   node scripts/docs-build.ts --untracked  fails when git tracks any file of it
 *
 * Nothing built is committed: every consumer builds the tree on demand and the site
 * deployment builds it from main (docs/LEARNING_PORTAL.md).
 */
import { reloadIn } from './docs-dev.ts';
import { buildSite, SITE_OUTPUT, trackedOutput } from './docs/site.ts';

if (!process.argv.includes('--untracked')) {
  await buildSite(undefined, undefined, process.argv.includes('--published'));
  // The reload of `docs:dev` is added by its server, never written into the tree.
  const reloading = reloadIn(SITE_OUTPUT);
  if (reloading.length) throw new Error(`the built site reloads itself: ${reloading.join(', ')}`);
} else {
  const tracked = trackedOutput();
  if (tracked.length) {
    console.error(
      `The built site is never tracked:\n${tracked.map((file) => `  ${file}`).join('\n')}`,
    );
    process.exit(1);
  }
  console.log('No file of the built site is tracked.');
}
