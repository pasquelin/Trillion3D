import roadmap from '../../content/gallery-roadmap.json' with { type: 'json' };
import { dictionaryOf, wordFor } from '../../content/i18n/dictionary.ts';
import type { Locale } from '../../content/locale.ts';
import { EXAMPLE_THUMBNAILS } from './thumbnails.inline.ts';

/** One entry of the gallery roadmap. A ready example has a file and no status. One still to write
 *  is `buildable`, or `needs-engine` with the feature it lacks. One written against the intended
 *  API but parked until the engine draws it is `waiting-engine`: its `file`, the feature it lacks
 *  and the `issue` that delivers it. Its words — title, the feature it lacks — are each language's
 *  `gallery`, by its id. */
interface RoadmapEntry {
  id: string;
  theme: string;
  file: string;
  status?: 'buildable' | 'needs-engine' | 'waiting-engine';
  issue?: number;
}

const roadmapEntries = roadmap.entries as RoadmapEntry[];

/** Whether an example is complete: it has source and waits on no engine capability. */
export const isReady = ({ file, status }: RoadmapEntry) => Boolean(file) && !status;

export const readyEntries = roadmapEntries.filter(isReady);

/** Written examples parked until the engine draws them, each naming the issue it waits for. */
export const parkedEntries = roadmapEntries.filter(({ status }) => status === 'waiting-engine');

/** Examples with source to open: complete ones and pages parked on an engine capability. */
export const writtenEntries = roadmapEntries.filter(({ file }) => Boolean(file));

export const writtenExampleIds = writtenEntries.map(({ id }) => id);

/** Each theme's presentation: runnable work first, then parked source, then unwritten titles. */
export const themedEntries = roadmap.themes.map((theme) => {
  const entries = roadmapEntries.filter((entry) => entry.theme === theme);
  return {
    theme,
    ready: entries.filter(isReady),
    parked: entries.filter((entry) => Boolean(entry.file) && !isReady(entry)),
    coming: entries.filter((entry) => !entry.file),
  };
});

/** Written examples in the sidebar, complete first and then parked, as on the gallery page. */
export const writtenThemes = themedEntries
  .map(({ theme, ready, parked }) => ({ theme, entries: [...ready, ...parked] }))
  .filter(({ entries }) => entries.length > 0);

/** A theme's title in `locale`: `gallery.themes.<id>`. */
export const themeTitle = (id: string, locale: Locale) =>
  wordFor(dictionaryOf(locale).gallery.themes, id) ?? id;

/** An example's title in `locale`: `gallery.titles.<id>`. */
export const exampleTitle = (id: string, locale: Locale) =>
  wordFor(dictionaryOf(locale).gallery.titles, id) ?? id;

/** The engine feature an example waits for, in `locale`, when it waits for one. */
export const exampleMissing = (id: string, locale: Locale) =>
  wordFor(dictionaryOf(locale).gallery.missing, id);

/** The flagships, shown large on the home page, one per band of its mosaic. */
const FLAGSHIPS = [
  'a-ring-of-lamps',
  'glass-on-the-table',
  'orbit-around-a-clockwork',
  'walk-through-a-temple',
  'spin-an-astrolabe',
  'a-terrain-from-a-height-map',
];

/** Examples kept off the home while a defect of the engine shows in them. */
const HELD_BACK = ['a-robot-that-walks-and-waves'];

const shown = readyEntries.filter(({ id }) => !HELD_BACK.includes(id));
const others = shown.filter(({ id }) => !FLAGSHIPS.includes(id));

/** Every ready example not held back, in the home mosaic's order: each flagship, then four of
 *  the others — a large tile and the four small ones beside it fill one band —, then the rest. */
export const mosaicEntries = [
  ...FLAGSHIPS.flatMap((id, index) => [
    ...shown.filter((entry) => entry.id === id),
    ...others.slice(index * 4, index * 4 + 4),
  ]),
  ...others.slice(FLAGSHIPS.length * 4),
].map((entry) => ({ entry, large: FLAGSHIPS.includes(entry.id) }));

export const examplePlaceholder = './assets/example-in-progress.svg';
const capturedExamples = new Set(EXAMPLE_THUMBNAILS);

/** The example's captured render when present at build time, otherwise the shared placeholder. */
export const thumbnailOf = (id: string) =>
  capturedExamples.has(id) ? `./assets/examples/thumbnails/${id}.png` : examplePlaceholder;
