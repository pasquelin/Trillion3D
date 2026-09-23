import type { EntryFrame } from '../i18n/entries.ts';
import { EDITOR_GUIDES } from './editorGuides.ts';

/** Guides: their words, prose in `html`, are each language's `written` text in `site/i18n/`. */
const GUIDE = { section: 'guides', kind: 'Guide' };

export const GUIDES: EntryFrame[] = [
  {
    ...GUIDE,
    id: 'three-migration',
  },
  {
    ...GUIDE,
    id: 'measurement-entry',
  },
  {
    ...GUIDE,
    id: 'createWorldJob',
    example: `const job = createJob('city-world', async ({ signal }) => {
  const world = createWorld('viewer', { signal });
  await world.scene.load('/cache/city/manifest.json', { signal });
  return world;
});
job.subscribe(() => console.log(job.getSnapshot().progress));
const world = await job.promise;`,
  },
  ...EDITOR_GUIDES,
];
