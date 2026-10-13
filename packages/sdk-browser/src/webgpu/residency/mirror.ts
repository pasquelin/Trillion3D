import type { GpuPageCache } from '../../gpu/page/pages.ts'
import type { PackedInstances } from '../row/instances.ts'

type MirrorOptions = {
  /** Packed ranks by pool address: read live, as pages join in place. */
  table: { readonly instances: Pick<PackedInstances, 'each'> }
  getCache: () => Pick<GpuPageCache, 'drainResidencyChanges'> | undefined
  onOffsetChange?: (page: number, offset: number) => void
}

/**
 * Names the packed ranks whose address arrived, left or moved in the cache — every address,
 * transparent keys outside the row table included —, from the cache's residency log alone
 * (`../../gpu/page/residencyLog.ts`): one entry a key, its last place. The slot itself is read on
 * the cache, where it is true (`../row/pageState.ts`, `offsetOf`): nothing is mirrored, so nothing
 * can drift and nothing is rebuilt.
 */
export function createWebgpuResidencyMirror(options: MirrorOptions) {
  const { table, getCache } = options
  const residencyKeys: string[] = [],
    residencySlots: number[] = []
  let dirty = true
  let offset = -1
  const named = (page: number) => options.onOffsetChange?.(page, offset)

  const sync = () => {
    const cache = getCache()
    if (!cache) return
    residencyKeys.length = 0
    residencySlots.length = 0
    cache.drainResidencyChanges(residencyKeys, residencySlots)
    if (residencyKeys.length) dirty = true
    for (let c = 0; c < residencyKeys.length; c++) {
      offset = residencySlots[c]
      table.instances.each(residencyKeys[c], named)
    }
  }

  return {
    sync,
    get dirty() {
      return dirty
    },
    set dirty(value: boolean) {
      dirty = value
    },
  }
}
