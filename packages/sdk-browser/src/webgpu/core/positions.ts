import type { PageRec } from '../../page/selection/types.ts'
import { hasPage } from '../row/pageSlots.ts'

/** The clusters no geometry page covers — a run-time mesh's, cut with none —, once the host
 *  vertices the WebGPU passes read for them are loaded: no session fetches them up front. A
 *  compiled cache gives every cluster its page, so none of its vertices is read here. */
export async function loadUnpaged(pages: readonly PageRec[]) {
  const unpaged = pages.filter((rec) => !rec.geometryPage && hasPage(rec))
  const lists = new Set(unpaged.flatMap((rec) => Object.values(rec.attributes)))
  await Promise.all(Array.from(lists, (list) => list._load()))
  return unpaged
}
