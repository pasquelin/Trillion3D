import roadmap from '../../content/gallery-roadmap.json' with { type: 'json' };
import { dictionaryOf, wordFor } from '../../content/i18n/dictionary.ts';
import type { Locale } from '../../content/locale.ts';

/** One entry of the gallery roadmap. A ready example has a file and no status. One still to write
 *  is `buildable`, or `needs-engine` with the feature it lacks. One written against the intended
 *  API but parked until the engine draws it is `waiting-engine`: its `file`, the feature it lacks
 *  and the `issue` that delivers it. One published apart, from its own repository, has no file
 *  and an `href`, the address its card opens. Its words — title, the feature it lacks — are each
 *  language's `gallery`, by its id. */
interface RoadmapEntry {
  id: string;
  theme: string;
  file: string;
  href?: string;
  status?: 'buildable' | 'needs-engine' | 'waiting-engine';
  issue?: number;
}

export const roadmapEntries = roadmap.entries as RoadmapEntry[];

/** Whether the gallery opens an entry: it has a file, and nothing left to wait for. */
export const isReady = ({ file, status }: RoadmapEntry) => Boolean(file) && !status;

export const readyEntries = roadmapEntries.filter(isReady);

export const readyExampleIds = readyEntries.map(({ id }) => id);

/** The ready examples, theme by theme, in the order of the file; a theme with none is left out. */
export const readyThemes = roadmap.themes
  .map((theme) => ({ theme, entries: readyEntries.filter((entry) => entry.theme === theme) }))
  .filter(({ entries }) => entries.length > 0);

/** Every entry of the list, theme by theme: the ready examples, and those still to come. */
export const themedEntries = roadmap.themes.map((theme) => ({
  theme,
  entries: roadmapEntries.filter((entry) => entry.theme === theme),
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
