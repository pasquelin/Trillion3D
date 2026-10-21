/**
 * WHAT THE PLACEMENTS OF ONE PARTITION SHARE (`cells.ts`, `placement`): the rows each one's view
 * asks of every mesh, summed when the rows are sized (`summedNeeds`), and the streamer's catalogue,
 * a file admitted by the first placement whose index names it and forgotten once the last one lets
 * it go (`sharedCatalogue`).
 */
import type { CellFrameIo } from './cellsPrime.ts'

/** What the placements of one partition share: the rows each one's view asks of every mesh, and
 *  the placements whose index names each file it admitted. */
export type PartitionShare = {
  needs: Map<object, ReadonlyMap<number, number>>
  admitted: Map<string, Set<object>>
}

/** The rows of each mesh every placement's view asks together. */
export function summedNeeds(needs: PartitionShare['needs']) {
  const sum = new Map<number, number>()
  for (const asked of needs.values())
    for (const [mesh, rows] of asked) sum.set(mesh, (sum.get(mesh) ?? 0) + rows)
  return sum
}

/** `io`'s catalogue as placement `self` holds it in `share`: a file is admitted by the first
 *  placement that names it and forgotten once the last one lets it go; one no placement admitted
 *  — the session catalogued it at open — is forgotten as before. */
export function sharedCatalogue(
  io: Pick<CellFrameIo, 'admit' | 'forget'>,
  share: PartitionShare,
  self: object,
): Pick<CellFrameIo, 'admit' | 'forget'> {
  return {
    admit(pages) {
      const fresh = pages.filter((page) => {
        const holders = share.admitted.get(page.url)
        if (holders) return (void holders.add(self), false)
        share.admitted.set(page.url, new Set([self]))
        return true
      })
      if (fresh.length) io.admit(fresh)
    },
    forget(urls) {
      const gone = urls.filter((url) => {
        const holders = share.admitted.get(url)
        if (!holders) return true
        holders.delete(self)
        if (holders.size) return false
        share.admitted.delete(url)
        return true
      })
      if (gone.length) io.forget(gone)
    },
  }
}
