import type { PageSurface } from './surface.ts'

/**
 * THE WRITES OF SURFACE RECORDS, as each consumer hears them: a journal is the set of records
 * written since its holder last emptied it. A record's owner writes it in place and calls
 * `surfaceWritten`, which bumps its version — what a memo keyed on the record compares — and lands
 * it in every open journal, so a consumer visits the records that moved, O(changed), and never
 * walks the ones that did not. A holder closes its journal when it goes.
 */
const journals = new Set<Set<PageSurface>>()

/** `record` was written in place: its version moves and every open journal hears it. */
export function surfaceWritten(record: PageSurface) {
  record.version++
  for (const journal of journals) journal.add(record)
}

/** A journal of the records written from now on; its holder empties it as it reads them. */
export function openSurfaceJournal(): Set<PageSurface> {
  const journal = new Set<PageSurface>()
  journals.add(journal)
  return journal
}

/** Stops filling `journal`: its holder is gone. */
export function closeSurfaceJournal(journal: Set<PageSurface>) {
  journals.delete(journal)
}
