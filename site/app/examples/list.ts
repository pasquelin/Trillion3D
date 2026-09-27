import roadmap from '../../content/gallery-roadmap.json' with { type: 'json' };
import { dictionaryOf, wordFor } from '../../content/i18n/dictionary.ts';
import type { Locale } from '../../content/locale.ts';

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

export const roadmapEntries = roadmap.entries as RoadmapEntry[];

/** Whether an example is complete: it has source and waits on no engine capability. */
export const isReady = ({ file, status }: RoadmapEntry) => Boolean(file) && !status;

export const readyEntries = roadmapEntries.filter(isReady);

/** Complete examples used by capture and browser proofs. */
export const readyExampleIds = readyEntries.map(({ id }) => id);

/** Examples with source to open: complete ones and pages parked on an engine capability. */
export const writtenEntries = roadmapEntries.filter(({ file }) => Boolean(file));

export const writtenExampleIds = writtenEntries.map(({ id }) => id);

/** Written examples in the sidebar, including parked pages whose source is useful to inspect. */
export const writtenThemes = roadmap.themes
  .map((theme) => ({ theme, entries: writtenEntries.filter((entry) => entry.theme === theme) }))
  .filter(({ entries }) => entries.length > 0);

/** Each theme's presentation: runnable work first, then parked source, then unwritten titles. */
export const themedEntries = roadmap.themes.map((theme) => ({
  theme,
  ready: roadmapEntries.filter((entry) => entry.theme === theme && isReady(entry)),
  parked: roadmapEntries.filter(
    (entry) => entry.theme === theme && Boolean(entry.file) && !isReady(entry),
  ),
  coming: roadmapEntries.filter((entry) => entry.theme === theme && !entry.file),
}));

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

/** The thumbnail an example's card and menu row show: its settled render. */
export const thumbnailOf = (id: string) => `./assets/examples/thumbnails/${id}.png`;
export const examplePlaceholder = './assets/example-in-progress.svg';
