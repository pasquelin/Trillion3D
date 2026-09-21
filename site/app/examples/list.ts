import roadmap from '../../content/gallery-roadmap.json' with { type: 'json' };

/** The examples list, theme by theme, in the order of the file. */
export const themedEntries = roadmap.themes.map((theme) => ({
  theme,
  entries: roadmap.entries.filter((entry) => entry.theme === theme.id),
}));

/** The examples that exist: an entry is done once it has a file. */
export const readyExampleIds = roadmap.entries.filter(({ file }) => file).map(({ id }) => id);
