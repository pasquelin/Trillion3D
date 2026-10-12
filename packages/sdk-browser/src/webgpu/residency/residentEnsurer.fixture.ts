import { IDENTITY_MATRIX4 } from '../../../../sdk-core/src/index.ts'
import type { PageRec } from '../../page/selection/selection.ts'
import { surfaceOf } from '../../page/surface.ts'
import type { createWebgpuPageTracking } from '../row/pageTracking.ts'
import { structureIndex } from '../../page/selection/structure.ts'
import type { ClusterRoot } from '../../page/selection/types.ts'
import { createPageParents } from '../../page/selection/pageParents.ts'
import { createWebgpuResidentEnsurer } from './residentEnsurer.ts'
import { createPageAdmission } from './admission.ts'
import type { LowerList, LowerPassOptions } from './lowerTier.ts'
import { createFrameBudget } from '../../page/integration/frameBudget.ts'
import { STREAMING_FRAME_MS } from '../../engine/common.ts'
import { PRIORITY_PREFETCH } from '../../streaming/priority.ts'

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
      { baseOfRoot: Int32Array.from([0]), packedCount: 1 },
      () => 0,
    ),
  }
}

/**
 * A pool of `slots` pages giving up its oldest page as the GPU's order would
 * (`../../gpu/page/eviction.ts`): never one pinned, nor one `inUse` says a view uses; to a prefetch
 * (a lower tier's load), never one `ahead` says the view ahead asks for either — the old pages alone.
 */
export function orderedPool(
  slots: number,
  inUse: (url: string) => boolean = () => false,
  ahead: (url: string) => boolean = () => false,
) {
  const resident = new Map<string, { key: string }>(),
    pins = new Set<string>(),
    /** The pages read for a place, in order. */
    reads: string[] = []
  /** What arrived since a reader last took it, kept once one asks, as the GPU page cache keeps it. */
  let arrivals: string[] | undefined
  const pin = (url: string) => void pins.add(url)
  const given = (lower: boolean) =>
    [...resident.keys()].filter((key) => !pins.has(key) && !inUse(key) && !(lower && ahead(key)))
  return {
    resident,
    pins,
    reads,
    get: (url: string) => resident.get(url),
    async load(url: string, _signal?: AbortSignal, pinned?: boolean, priority?: number) {
      if (resident.size >= slots && !resident.has(url)) {
        // No place to give: refused before any read, as the cache refuses (`../../gpu/page/load.ts`).
        const victim = given(priority === PRIORITY_PREFETCH)[0]
        if (victim === undefined) throw new Error('POOL_FULL')
        resident.delete(victim)
      }
      if (!resident.has(url)) reads.push(url)
      resident.set(url, { key: url })
      arrivals?.push(url)
      if (pinned) pin(url)
    },
    takeArrivals(visit: (key: string) => void) {
      const arrived = (arrivals ??= [])
      for (const key of arrived) visit(key)
      arrived.length = 0
    },
    pin,
    isPinned: (url: string) => pins.has(url),
    unpin: (url: string) => pins.delete(url),
    takeUnpinned() {},
    stats: () => ({ pinned: pins.size }),
    room: (lower = false) => slots - resident.size + given(lower).length,
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

/** The lower pass's options over `cache`, as the ensurer builds them, `lowerTiers` its tiers: no
 *  read ahead, and a share that never waits. */
export function lowerPassOptions(
  tracking: ReturnType<typeof createWebgpuPageTracking>,
  cache: unknown,
  lowerTiers: () => readonly LowerList[],
): LowerPassOptions {
  const options = { ...ensurerOptions(tracking, cache), lowerTiers }
  return {
    ...options,
    admit: createPageAdmission(options),
    budget: createFrameBudget(STREAMING_FRAME_MS),
    nextShare: async () => {},
    readAhead: undefined,
  }
}

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
