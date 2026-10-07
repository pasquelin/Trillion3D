import { IDENTITY_MATRIX4 } from '../../../../sdk-core/src/index.ts'
import type { PageRec } from '../../page/selection/selection.ts'
import { surfaceOf } from '../../page/surface.ts'
import type { createWebgpuPageTracking } from '../row/pageTracking.ts'
import { structureIndex } from '../../page/selection/structure.ts'
import type { ClusterRoot } from '../../page/selection/types.ts'
import { createPageParents } from '../../page/selection/pageParents.ts'
import { createWebgpuResidentEnsurer } from './residentEnsurer.ts'

/** Fields the residency ensurer never reads: shared across every fixture page. */
const IDENTITY = { elements: IDENTITY_MATRIX4 }
const DUMMY_BOUNDS: number[] = [0, 0, 0]
/** An engine page record keyed by `url`. The host-side fields stay absent: the ensurer reads
 *  the engine record alone, and a fixture of the engine path carries no witness library. */
export const pageOf = (url: string) =>
  ({
    id: 0,
    url,
    clusterId: url,
    array: new Uint32Array(1),
    triangles: 0,
    indexBytes: 0,
    min: DUMMY_BOUNDS,
    max: DUMMY_BOUNDS,
    depthLayer: 0,
    material: surfaceOf([]),
    renderOrder: 0,
    attached: true,
  }) as unknown as PageRec

/** One placement: the root `r`, the mid cluster `m` replacing the leaves `a` and `b`, and `r`
 *  replacing `m`. Group 0 turns `m` into `r`, group 1 turns `a` and `b` into `m`. */
export function placement() {
  const pages = ['r', 'm', 'a', 'b'].map(pageOf)
  const groups = [0, 1, 1].map((group, i) => [pages[i + 1], group] as const)
  for (const [page, group] of groups) page.group = group
  const band = { error: 1, sphere: [0, 0, 0, 1] }
  const structure = structureIndex(
    {
      version: 1,
      roots: [0],
      groups: [
        { level: 1, ...band, children: [1], outputs: [0] },
        { level: 0, ...band, children: [2, 3], outputs: [1] },
      ],
    },
    pages.length,
  )
  const root = { world: IDENTITY, pages, structure } as unknown as ClusterRoot<PageRec>
  return {
    pages,
    root,
    parentsOf: createPageParents(
      [root],
      { baseOfRoot: Int32Array.from([0]), rootOfPacked: Int32Array.from([0]) },
      () => 0,
    ),
  }
}

/** A pool of `slots` pages evicting its oldest unpinned page, as the GPU page cache does. */
export function lruCache(slots: number) {
  const resident = new Map<string, { key: string }>(),
    pins = new Set<string>(),
    held = new Set<string>()
  const pin = (url: string, tier: 'held' | 'pinned' = 'pinned') => {
    pins.add(url)
    if (tier === 'held') held.add(url)
  }
  return {
    resident,
    pins,
    held,
    get: (url: string) => resident.get(url),
    async load(url: string, _signal?: AbortSignal, tier?: 'held' | 'pinned') {
      if (resident.size >= slots) {
        const victim = [...resident.keys()].find((key) => !pins.has(key))
        if (victim === undefined) throw new Error('ALL_PAGES_PINNED')
        resident.delete(victim)
      }
      resident.set(url, { key: url })
      if (tier) pin(url, tier)
    },
    pin,
    unpin: (url: string) => (held.delete(url), pins.delete(url)),
    touch(url: string) {
      const page = resident.get(url)
      if (!page) return false
      resident.delete(url)
      resident.set(url, page)
      return true
    },
    unpinnedSlots: () => slots - pins.size,
  }
}

/** An ensurer's options over `cache`: no cover, every page's bytes at hand, no parents, no tier. */
export const ensurerOptions = (
  tracking: ReturnType<typeof createWebgpuPageTracking>,
  cache: unknown,
): Parameters<typeof createWebgpuResidentEnsurer>[0] => ({
  getCache: () => cache as never,
  tracking,
  bootstrapKey: new Uint8Array(tracking.keyCount),
  hasBytes: () => true,
  parentsOf: () => [],
  isLost: () => false,
  traceEnabled: false,
  traceDiagnostic: () => {},
  lowerTiers: () => [],
  bytesRevision: () => 0,
})

/** An ensurer over `cache` whose first lower tier is `firstPages`, and the second `nextPages`. */
export const tierEnsurer = (
  tracking: ReturnType<typeof createWebgpuPageTracking>,
  cache: unknown,
  firstPages: () => readonly PageRec[],
  nextPages: () => readonly PageRec[] = () => [],
) =>
  createWebgpuResidentEnsurer({
    ...ensurerOptions(tracking, cache),
    lowerTiers: () =>
      [firstPages(), nextPages()].map((pages) => ({
        pages,
        has: (key: number) => pages.some((page) => tracking.keyOf(page) === key),
        revision: 0,
      })),
  })
