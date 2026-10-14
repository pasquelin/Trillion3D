import { clusterHash } from '../../visibility/math.ts'

/**
 * What writing a page row would recompute every time though it depends only on the compiled
 * catalogue: the cluster hash — a code-point array per write.
 *
 * Twelve placements of the same scene share their clusters: one memo per cluster id is enough to
 * compute it once and for all, however many pages arrive in the image. What a surface brings to
 * its rows is kept with its record, in the material table (`SurfaceSeen.row`,
 * `../material/materialTable.ts`).
 */
export function createPageRowConstants() {
  const hashes = new Map<string, number>()
  return {
    /** Hash of a cluster id, computed at its first row. */
    hashOf(clusterId: string) {
      const held = hashes.get(clusterId)
      if (held !== undefined) return held
      const hash = clusterHash(clusterId)
      hashes.set(clusterId, hash)
      return hash
    },
  }
}
