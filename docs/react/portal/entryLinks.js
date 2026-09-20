export function symbolOf(label) {
  return label.replace(/\(\)$/, '').trim();
}

export function entryLinks(entry) {
  const labels = (entry.title || entry.id).split(/\s*·\s*/).filter(Boolean);
  const primaryIndex = Math.max(
    0,
    labels.findIndex((label) => symbolOf(label) === entry.id),
  );
  return labels.map((label, index) => ({
    entry,
    key: `${entry.id}:${symbolOf(label)}`,
    id: symbolOf(label),
    label,
    primary: index === primaryIndex,
  }));
}

export function canonicalEntryId(entries, id) {
  if (entries.some((entry) => entry.id === id)) return id;
  return expandEntryLinks(entries).find((link) => link.id === id)?.entry.id ?? id;
}

export function expandEntryLinks(entries) {
  return entries.flatMap(entryLinks);
}
