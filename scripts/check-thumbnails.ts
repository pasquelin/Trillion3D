// A gallery example with no capture of its own shows the shared placeholder card. Every written
// example the engine draws — not parked (`parkedExampleIds`) — must have its
// `site/assets/examples/thumbnails/<id>.png`, which the measurer captures with
// `node scripts/docs-examples-thumbnails.ts <id>`. `pnpm run check:thumbnails`.
import { pathToFileURL } from 'node:url';
import { writtenEntries } from '../site/app/examples/list.ts';
import { EXAMPLE_THUMBNAILS } from '../site/app/examples/thumbnails.inline.ts';
import { parkedExampleIds } from './docs/examples/pages.ts';

/** The ids of `entries` neither `parked` nor among the `captured` thumbnails. */
export const missingThumbnails = (
  entries: readonly { id: string }[],
  parked: ReadonlySet<string>,
  captured: readonly string[],
) => entries.map(({ id }) => id).filter((id) => !parked.has(id) && !captured.includes(id));

/** The gallery's examples that miss a thumbnail today. */
export const galleryMissingThumbnails = () =>
  missingThumbnails(writtenEntries, parkedExampleIds, EXAMPLE_THUMBNAILS);

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const missing = galleryMissingThumbnails();
  if (missing.length) {
    console.error(
      `Gallery examples with no thumbnail, and not parked: ${missing.join(', ')}.\n` +
        'Capture each with `node scripts/docs-examples-thumbnails.ts <id>`, or park it.',
    );
    process.exitCode = 1;
  } else console.log('Every gallery example that is not parked has its thumbnail.');
}
