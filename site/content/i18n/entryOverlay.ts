import type { PortalEntry, PortalEntryValue } from '../model.ts';

/**
 * A partial translation of one entry, keyed by its id. `values` overlays the entry's own
 * `values` array by position, so only the translated field of each value needs to be given.
 */
export type EntryOverlay = Partial<Omit<PortalEntry, 'values'>> & {
  values?: Partial<PortalEntryValue>[];
};

/** A locale's translation table: one overlay per entry id. */
export type LocaleOverlay = Record<string, EntryOverlay>;
