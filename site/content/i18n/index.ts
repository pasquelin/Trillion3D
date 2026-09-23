import { FRENCH } from './overlays.ts';
import { sectionStrings } from './sections.ts';
import { STRINGS } from './strings.ts';
import type { EntryOverlay } from './entryOverlay.ts';
import type { Locale } from '../locale.ts';
import type { PortalEntry } from '../model.ts';

export const supportedLocales: Locale[] = ['en', 'fr'];

export function t(locale: Locale, key: string) {
  const selected = supportedLocales.includes(locale) ? locale : 'en';
  return (
    STRINGS[selected]?.[key] ??
    sectionStrings[selected]?.[key] ??
    STRINGS.en[key] ??
    sectionStrings.en[key] ??
    key
  );
}

function localizedEntry(entry: PortalEntry, overlay: EntryOverlay | null) {
  if (!overlay) return { ...entry };
  const { values: translated, ...fields } = overlay;
  const result: PortalEntry = { ...entry, ...fields };
  if (entry.values)
    result.values = entry.values.map((value, index) => ({ ...value, ...translated?.[index] }));
  return result;
}

export function localizeEntries(entries: PortalEntry[], locale: Locale) {
  return entries.map((entry) => localizedEntry(entry, locale === 'fr' ? FRENCH[entry.id] : null));
}
