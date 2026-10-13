import type { Texture } from './contract.ts'

/**
 * THE WRITES OF TEXTURE RECORDS, as each consumer hears them: a journal is the set of records
 * written since its holder last emptied it. A record's own write (`world/texture/texture.ts`)
 * lands in every open journal, so a consumer visits the records that moved — O(changed) a frame —
 * and never walks the ones that did not. A holder closes its journal when it goes.
 */
const journals = new Set<Set<Texture>>()

/** Tells every open journal that `record` was written: its picture, sampling or placement. */
export function textureWritten(record: Texture) {
  for (const journal of journals) journal.add(record)
}

/** A journal of the records written from now on; its holder empties it as it reads them. */
export function openTextureJournal(): Set<Texture> {
  const journal = new Set<Texture>()
  journals.add(journal)
  return journal
}

/** Stops filling `journal`: its holder is gone. */
export function closeTextureJournal(journal: Set<Texture>) {
  journals.delete(journal)
}
