import roadmap from '../../content/gallery-roadmap.json' with { type: 'json' };

/** The examples that exist: an entry is ready once it has a file. */
export const readyEntries = roadmap.entries.filter(({ file }) => file);

export const readyExampleIds = readyEntries.map(({ id }) => id);

/** The ready examples, theme by theme, in the order of the file; a theme with none is left out. */
export const readyThemes = roadmap.themes
  .map((theme) => ({ theme, entries: readyEntries.filter((entry) => entry.theme === theme.id) }))
  .filter(({ entries }) => entries.length > 0);

/** The thumbnail an example's card and menu row show: its settled render. */
export const thumbnailOf = (id: string) => `./assets/examples/thumbnails/${id}.png`;
