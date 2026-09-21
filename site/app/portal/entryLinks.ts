import type { PortalEntry } from '../../content/model.ts';

export interface EntryLinkItem {
  entry: PortalEntry;
  key: string;
  id: string;
  label: string;
  primary: boolean;
}

function symbolOf(label: string): string {
  return label.replace(/\(\)$/, '').trim();
}

function isIdentifier(label: string): boolean {
  return /^[A-Za-z_$][\w$]*$/.test(symbolOf(label));
}

function entryLinks(entry: PortalEntry): EntryLinkItem[] {
  const labels = (entry.title || entry.id).split(/\s*·\s*/).filter(Boolean);
  const primaryIndex = Math.max(
    0,
    labels.findIndex((label) => symbolOf(label) === entry.id),
  );
  return labels.map((label, index) => ({
    entry,
    key: `${entry.id}:${symbolOf(label)}`,
    id: isIdentifier(label) ? symbolOf(label) : entry.id,
    label,
    primary: index === primaryIndex,
  }));
}

export function canonicalEntryId(entries: PortalEntry[], id: string): string {
  let decoded = id;
  try {
    decoded = decodeURIComponent(id);
  } catch {
    /* The route resolver will display its ordinary not-found page. */
  }
  if (entries.some((entry) => entry.id === decoded)) return decoded;
  return (
    expandEntryLinks(entries).find((link) => link.id === decoded || link.label === decoded)?.entry
      .id ?? decoded
  );
}

export function expandEntryLinks(entries: PortalEntry[]): EntryLinkItem[] {
  return entries.flatMap(entryLinks);
}
