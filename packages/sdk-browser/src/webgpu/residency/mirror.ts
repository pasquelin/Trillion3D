import type { createGpuPageCache } from '../../gpu/page/pages.ts'
import type { createWebgpuDiagnostics } from '../pages/io/diagnostics.ts'
import type { createWebgpuPageTracking } from '../row/pageTracking.ts'
import type { PackedInstances } from '../row/instances.ts'

type Cache = ReturnType<typeof createGpuPageCache>
type MirrorOptions = {
  /** Packed ranks by pool address, and each address's slot: read live, as pages join in place. */
  table: {
    readonly instances: Pick<PackedInstances, 'each'>
    addressOffset(address: string): number
    setAddressOffset(address: string, words: number): void
    clearAddressOffsets(): void
  }
  tracking: ReturnType<typeof createWebgpuPageTracking>
  engineDiagnostic: ReturnType<typeof createWebgpuDiagnostics>['engineDiagnostic']
  getCache: () => Cache | undefined
  getFrame: () => number
  onOffsetChange?: (page: number, offset: number) => void
}

/** Tracks cache arrivals and departures — every address, transparent keys outside the row table
 *  included: one slot an address, which each of its instances reads (`../row/pageState.ts`). */
export function createWebgpuResidencyMirror(options: MirrorOptions) {
  const { table, tracking, engineDiagnostic, getCache, getFrame } = options
  const residencyKeys: string[] = [],
    residencySlots: number[] = []
  let journalResident = 0
  let dirty = true

  let offset = -1
  const named = (page: number) => options.onOffsetChange?.(page, offset)
  /** Address `key` takes slot `words`, each of its packed ranks named when it moved. */
  const setOffsets = (key: string, words: number) => {
    if (table.addressOffset(key) === words) return
    table.setAddressOffset(key, words)
    offset = words
    table.instances.each(key, named)
  }

  const sync = () => {
    const cache = getCache()
    if (!cache) return
    residencyKeys.length = 0
    residencySlots.length = 0
    cache.drainResidencyChanges(residencyKeys, residencySlots)
    if (residencyKeys.length) dirty = true
    for (let c = 0; c < residencyKeys.length; c++) {
      const key = residencyKeys[c],
        offsetWords = residencySlots[c]
      const was = table.addressOffset(key) >= 0
      if (offsetWords >= 0 && !was) journalResident++
      else if (offsetWords < 0 && was) journalResident--
      setOffsets(key, offsetWords)
    }
    const resident = cache.residentPages
    if (journalResident === resident) return
    engineDiagnostic('gpu-residency-mirror-rebuilt', 'Residency mirror rebuilt from the cache', {
      frame: getFrame(),
      journal: journalResident,
      resident,
    })
    dirty = true
    journalResident = 0
    for (const url of tracking.pageCatalog) {
      const page = cache.get(url)
      if (page) journalResident++
      setOffsets(url, page ? page.offset / 4 : -1)
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
