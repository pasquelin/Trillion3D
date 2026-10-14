/**
 * THE WRITES OF A KIND OF RECORD, as each consumer hears them: a journal is the set of records
 * written since its holder last emptied it. A record's write lands in every open journal, so a
 * consumer visits the records that moved — O(changed) a frame — and never walks the ones that did
 * not. A holder closes its journal when it goes. One instance per kind: the texture records
 * (`../texture/writes.ts`) and the surface records (`sdk-browser/src/page/surfaceWrites.ts`).
 */
export function createWriteJournals<T>() {
  const journals = new Set<Set<T>>()
  return {
    /** Tells every open journal that `record` was written. */
    written(record: T) {
      for (const journal of journals) journal.add(record)
    },
    /** A journal of the records written from now on; its holder empties it as it reads them. */
    open(): Set<T> {
      const journal = new Set<T>()
      journals.add(journal)
      return journal
    },
    /** Stops filling `journal`: its holder is gone. */
    close(journal: Set<T>) {
      journals.delete(journal)
    },
  }
}
