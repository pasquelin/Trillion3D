import roadmap from '../../content/gallery-roadmap.json' with { type: 'json' };

/** One entry of the gallery roadmap. A ready example has a file and no status. One still to write
 *  is `buildable`, or `needs-engine` with the feature it lacks (`missing`). One written against
 *  the intended API but parked until the engine draws it is `waiting-engine`: its `file`, the
 *  feature it lacks and the `issue` that delivers it. */
interface RoadmapEntry {
  id: string;
  title: { en: string; fr: string };
  theme: string;
  file: string;
  status?: 'buildable' | 'needs-engine' | 'waiting-engine';
  missing?: { en: string; fr: string };
  issue?: number;
}

export const roadmapEntries = roadmap.entries as RoadmapEntry[];

/** Whether the gallery opens an entry: it has a file, and nothing left to wait for. */
export const isReady = ({ file, status }: RoadmapEntry) => Boolean(file) && !status;

export const readyEntries = roadmapEntries.filter(isReady);

export const readyExampleIds = readyEntries.map(({ id }) => id);

/** The ready examples, theme by theme, in the order of the file; a theme with none is left out. */
export const readyThemes = roadmap.themes
  .map((theme) => ({ theme, entries: readyEntries.filter((entry) => entry.theme === theme.id) }))
  .filter(({ entries }) => entries.length > 0);

/** Every entry of the list, theme by theme: the ready examples, and those still to come. */
export const themedEntries = roadmap.themes.map((theme) => ({
  theme,
  entries: roadmapEntries.filter((entry) => entry.theme === theme.id),
}));

/** The thumbnail an example's card and menu row show: its settled render. */
export const thumbnailOf = (id: string) => `./assets/examples/thumbnails/${id}.png`;
