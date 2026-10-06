// A gallery example with no capture of its own shows the shared placeholder card. The recette
// lists every written example the engine draws — not parked (`parkedExampleIds`) — that has no
// `site/assets/examples/thumbnails/<id>.png` yet, and captures it after the merge with
// `node scripts/docs/examples-thumbnails.ts <id>` (AGENTS.md rule 2). A report, never a gate: a
// missing thumbnail blocks no pull request. `pnpm run check:thumbnails`.
import { pathToFileURL } from 'node:url';
import { writtenEntries } from '../site/app/examples/list.ts';
import { EXAMPLE_THUMBNAILS } from '../site/app/examples/thumbnails.inline.ts';
import { parkedExampleIds } from './docs/examples/pages.ts';

/** The ids of `entries` neither `parked` nor among the `captured` thumbnails. */
export const missingThumbnails = (
  entries: readonly { id: string }[],
  parked: ReadonlySet<string>,
  captured: ReadonlySet<string>,
) => entries.map(({ id }) => id).filter((id) => !parked.has(id) && !captured.has(id));

/** The report line the recette reads: the ids still to capture, or none. Never a failure. */
export const thumbnailReport = (missing: readonly string[]) =>
  missing.length
    ? `Thumbnails for the recette to capture: ${missing.join(' ')}`
    : 'Every gallery example that is not parked has its thumbnail.';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  console.log(
    thumbnailReport(
      missingThumbnails(writtenEntries, parkedExampleIds, new Set(EXAMPLE_THUMBNAILS)),
    ),
  );
