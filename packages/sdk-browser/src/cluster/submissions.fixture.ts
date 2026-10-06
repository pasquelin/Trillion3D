// What a backend submitted for the cut, as the tests read it: its draw records and the index ranges
// each one draws (`batchMesh.ts`).
import { isClusterDrawMesh, type ClusterDraw } from './batchMesh.ts'

/** A backend whose paged clusters the engine's program draws publishes its submissions here.
 *  The tests read them; neither the engine nor a host does, so the public backend contract does
 *  not carry it. */
interface ClusterDrawSource {
  clusterDraws(): readonly ClusterDraw[]
}
/** The draw records a backend submits for the cut; none from one that owns no cluster. */
export function submittedDraws(backend: object): readonly ClusterDraw[] {
  return (backend as Partial<ClusterDrawSource>).clusterDraws?.() ?? []
}
/** Index ranges a submission draws: those of a batch record, the whole index — or the whole
 *  vertex list, a wireframe page being non-indexed — of a page mesh. */
export function* drawnRanges(draw: ClusterDraw): Generator<[number, number]> {
  if (!isClusterDrawMesh(draw)) {
    yield [0, draw.geometry.index?.count ?? draw.geometry.attributes.position.count]
    return
  }
  for (let range = 0; range < draw._multiDrawCount; range++)
    yield [
      draw._multiDrawStarts[range] / Uint32Array.BYTES_PER_ELEMENT,
      draw._multiDrawCounts[range],
    ]
}
