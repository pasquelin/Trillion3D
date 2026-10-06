import type { ClusterRoot, PageRec } from '../../page/selection/selection.ts'

import { hostPageBytes } from '../../host/pageObjects.ts'
import { attachedPages, drawnInstancedAt } from '../../placement/autonomousPlacements.ts'
import type { Geometry } from '../../../../sdk-core/src/world/geometry/geometry.ts'
import type { PageDraws } from './pageDraws.ts'

/**
 * Decoded bytes nothing may evict: the root cover and the pages the host replaced, counted as the
 * store's `allocationBytes` counts them — every geometry a record holds, an instance's copies
 * included, and a geometry several records share once. Read again only after `changed` —
 * prepare, a page replaced — or `placed` — an instance added or removed, rows grown —: a pose or
 * a material leaves them as they are.
 */
export function createHeldFloor(env: {
  roots: readonly ClusterRoot<PageRec>[]
  bootstrap: readonly PageRec[]
  modifiedPages: ReadonlySet<string>
  byUrl: ReadonlyMap<string, readonly PageRec[]>
  /** The per-instance draw state, keyed by packed index (`pageDraws.ts`): the record carries none. */
  draws: PageDraws
  /** The host's page ceiling, `Infinity` when it set none. */
  hostCeiling?: number
}) {
  const { roots, bootstrap, modifiedPages, byUrl, draws, hostCeiling = Infinity } = env
  let revision = 0,
    placements = 0,
    read = -1,
    bytes = 0,
    meshesRead = -1,
    counted = 0
  function meshes() {
    if (meshesRead === revision) return counted
    meshesRead = revision
    return (counted = attachedPages(bootstrap, (rec) =>
      drawnInstancedAt(roots, draws.rootRankOf(rec), rec),
    ))
  }
  return {
    /** What the root cover holds changed; the pool reads the same revision (`coverRevision`). */
    changed() {
      revision++
    },
    get revision() {
      return revision
    },
    /** The placements changed — an instance added or removed, rows grown —, and so the cover. */
    placed() {
      placements++
      revision++
    },
    /** Moves with `placed` only: a page replaced leaves the placements' layout as it is
     *  (`requests.ts`), so reading the host bytes after it walks none of them. */
    get placements() {
      return placements
    },
    bytes() {
      if (read === revision) return bytes
      read = revision
      bytes = 0
      const seen = new Set<Geometry>()
      const add = (rec: PageRec) => {
        const geometry = draws.geometryOf(rec)
        if (!geometry || seen.has(geometry)) return
        seen.add(geometry)
        bytes += hostPageBytes(geometry)
      }
      for (const rec of bootstrap) add(rec)
      for (const url of modifiedPages) for (const rec of byUrl.get(url) ?? []) add(rec)
      return bytes
    },
    /** The display meshes the root cover hangs (`attachedPages`), read again only after
     *  `changed`: a transparent page counts once per row that places it. */
    meshes,
    /** The host page ceiling's one rule — at open, at an instance, at a class change: the cover's
     *  meshes, counted anew for a move tried, and `more` an instance adds, past the ceiling. */
    overCeiling: (more = 0, cover = meshes()) => cover + more > hostCeiling,
  }
}

export type HeldFloor = ReturnType<typeof createHeldFloor>
