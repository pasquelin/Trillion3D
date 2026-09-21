import { boundsFr } from './bounds.fr.ts';
import { cameraFr } from './camera.fr.ts';
import { enumsFr } from './enums.fr.ts';
import { guidesFr } from './guides.fr.ts';
import { lifecycleFr } from './lifecycle.fr.ts';
import { matrixFr } from './matrix.fr.ts';
import { sectionStrings } from './sections.ts';
import { STRINGS } from './strings.ts';
import { treeFr } from './tree.fr.ts';
import { vectorFr } from './vector.fr.ts';
import type { EntryOverlay, LocaleOverlay } from './entryOverlay.ts';
import type { Locale } from '../locale.ts';
import type { PortalEntry } from '../model.ts';

export const supportedLocales: Locale[] = ['en', 'fr'];

const FRENCH: LocaleOverlay = Object.assign(
  {},
  boundsFr,
  cameraFr,
  enumsFr,
  guidesFr,
  lifecycleFr,
  matrixFr,
  treeFr,
  vectorFr,
);

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

export type TranslateFn = typeof t;

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
