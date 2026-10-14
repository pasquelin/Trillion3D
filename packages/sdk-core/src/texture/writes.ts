import type { Texture } from './contract.ts'
import { createWriteJournals } from '../runtime/writeJournals.ts'

/** THE WRITES OF TEXTURE RECORDS: a record's own write (`world/texture/texture.ts`) — its picture,
 *  sampling or placement — lands in every open journal (`createWriteJournals`). */
export const textureJournals = createWriteJournals<Texture>()
