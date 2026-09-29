// A gallery example with no capture of its own shows the shared placeholder card. Every written
// example the engine draws — not parked (`parkedExampleIds`) — must have its
// `site/assets/examples/thumbnails/<id>.png`, which the recette captures with
// `node scripts/docs-examples-thumbnails.ts <id>`. `pnpm run check:thumbnails`.
import { pathToFileURL } from 'node:url';
import { writtenEntries } from '../site/app/examples/list.ts';
import { EXAMPLE_THUMBNAILS } from '../site/app/examples/thumbnails.inline.ts';
import { parkedExampleIds } from './docs/examples/pages.ts';

// #357: the boss explicitly deferred these four captures to recette after merge.
// Remove each exception when its own thumbnail is captured; other examples stay mandatory.
export const recettePendingThumbnailIds: ReadonlySet<string> = new Set([
  'a-character-that-walks',
  'additive-poses',
  'a-crowd-of-characters',
  'a-shape-that-morphs',
]);

/** Missing captures, excluding parked examples and explicitly deferred recette captures. */
export const missingThumbnails = (
  entries: readonly { id: string }[],
  parked: ReadonlySet<string>,
  captured: ReadonlySet<string>,
  deferred: ReadonlySet<string> = new Set(),
) =>
  entries
    .map(({ id }) => id)
    .filter((id) => !parked.has(id) && !captured.has(id) && !deferred.has(id));

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const captured = new Set(EXAMPLE_THUMBNAILS);
  const missing = missingThumbnails(
    writtenEntries,
    parkedExampleIds,
    captured,
    recettePendingThumbnailIds,
  );
  if (missing.length) {
    console.error(
      `Gallery examples with no thumbnail, and not parked: ${missing.join(', ')}.\n` +
        'Capture each with `node scripts/docs-examples-thumbnails.ts <id>`, or park it.',
    );
    process.exitCode = 1;
  } else {
    const pending = missingThumbnails(writtenEntries, parkedExampleIds, captured);
    console.log(
      pending.length
        ? `Gallery thumbnails pass; #357 captures explicitly deferred to recette: ${pending.join(', ')}.`
        : 'Every gallery example that is not parked has its thumbnail.',
    );
  }
}
