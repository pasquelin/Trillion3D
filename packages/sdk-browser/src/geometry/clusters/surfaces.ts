import type { PageSurface } from '../pages/surface.ts'

/**
 * THE DISTINCT SURFACES THE RESIDENT CLUSTERS WEAR, kept as the cluster residency writes and lets go
 * of cluster records (`./clusterResidency.ts`): a count for each surface, the list of them held
 * until one comes or goes. What a frame asks of the surfaces — whether one of them wears a lobe,
 * a subsurface sheet — is answered once for a list (`../pages/rowSurfaces.ts`), so a frame over
 * still clusters and materials asks it in O(1), however many surfaces they wear.
 */
export function createResidentSurfaces() {
  const surfaceOf = new Map<number, PageSurface>(),
    counts = new Map<PageSurface, number>()
  let held: PageSurface[] | undefined
  const drop = (record: number) => {
    const surface = surfaceOf.get(record)
    if (!surface) return
    surfaceOf.delete(record)
    const left = counts.get(surface)! - 1
    if (left) counts.set(surface, left)
    else {
      counts.delete(surface)
      held = undefined
    }
  }
  return {
    /** Cluster record `record` wears `surface`. */
    set(record: number, surface: PageSurface) {
      if (surfaceOf.get(record) === surface) return
      drop(record)
      surfaceOf.set(record, surface)
      const was = counts.get(surface) ?? 0
      counts.set(surface, was + 1)
      if (!was) held = undefined
    },
    /** Cluster record `record` let go. */
    drop,
    /** Every record let go. */
    clear() {
      surfaceOf.clear()
      counts.clear()
      held = undefined
    },
    /** The surfaces the records wear, each once: the same array while none came or went. */
    list: () => (held ??= [...counts.keys()]),
    /** Bytes of the maps: a few words for each record written. */
    get hostBytes() {
      return surfaceOf.size * 16
    },
  }
}
