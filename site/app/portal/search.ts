import type { PortalEntry } from '../../content/model.ts';

function normalized(value: string | undefined) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

function searchDocument(entry: PortalEntry) {
  return normalized(
    [entry.title, entry.id, entry.signature, entry.description, entry.module, entry.kind]
      .filter(Boolean)
      .join(' '),
  );
}

export function searchEntries(entries: PortalEntry[], query: string) {
  const words = normalized(query).trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return entries;
  return entries
    .map((entry, order) => {
      const title = normalized(entry.title || entry.id);
      const document = searchDocument(entry);
      if (!words.every((word) => document.includes(word))) return null;
      const score = words.reduce(
        (total, word) => total + (title.startsWith(word) ? 3 : title.includes(word) ? 2 : 1),
        0,
      );
      return { entry, order, score };
    })
    .filter((match) => match !== null)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map(({ entry }) => entry);
}
