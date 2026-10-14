import type { PageSurface } from './surface.ts'
import { createWriteJournals } from '../../../sdk-core/src/runtime/writeJournals.ts'

/** THE WRITES OF SURFACE RECORDS: a record's owner writes it in place and calls `surfaceWritten`,
 *  which lands it in every open journal (`createWriteJournals`). */
export const surfaceJournals = createWriteJournals<PageSurface>()

/** `record` was written in place: its version moves — what a memo keyed on the record compares —
 *  and every open journal hears it. */
export function surfaceWritten(record: PageSurface) {
  record.version++
  surfaceJournals.written(record)
}
