import type { createGpuPageReader } from './reader.ts'
import type { PageHomes, PageUnitsOf } from './homes.ts'
import type { Eviction } from './eviction.ts'
import type { Placement, RootSlots } from './placement.ts'
import type { ResidencyLog } from './residencyLog.ts'
import type { PageInstaller } from '../install/installer.ts'

/** One page held in the GPU page pool. */
export interface ResidentPage {
  /** Its key. */
  key: string
  /** Its byte offset. */
  offset: number
  /** Its size as it was installed from: the bytes of its page on disk, or of the raw page it is. */
  bytes: number
  /** The cache's placing count when it landed (`commit.ts`): a page placed again reads another. */
  generation: number
}
export type GpuPageContext = {
  device: GPUDevice
  /** The width of a slot: the widest streaming page's. */
  pageBytes: number
  /** Streaming pages the pool holds at once, its root grains included. */
  slots: number
  /** Its root region, behind the streaming slots (`placement.ts`). */
  roots: RootSlots
  /** Each streaming page's width and home (`homes.ts`): the allocator's (`placement.ts`). */
  homes?: PageHomes
  /** Each address's streaming page and offset there (`homes.ts`). */
  units?: PageUnitsOf
  buffer: GPUBuffer
  /** Writes the pages on disk into the pool, transcoded (`../install/installer.ts`). */
  install: PageInstaller
  resident: Map<string, ResidentPage>
  /** The root cover's pages: a pool never goes below them (`resize.ts`). */
  cover: ReadonlySet<string>
  /** Every root page's address: the root region's grains hold them (`placement.ts`). */
  rootUrls: ReadonlySet<string>
  abort: AbortController
  state: {
    pending: Promise<unknown>
    disposed: boolean
    /** Loads in flight: each takes a slot when it lands. */
    loading: number
    generation: number
    bytesRead: number
    uploadedBytes: number
    evictions: number
  }
  /** The pages the pool keeps whatever the host asks: its pins (`eviction.ts`). */
  eviction: Eviction
  /** Where an arrival lands: the pool's one allocator (`placement.ts`). */
  placement: Placement
  /** The changes the host has not drained yet (`residencyLog.ts`). */
  changes: ResidencyLog
  reader: ReturnType<typeof createGpuPageReader>
  check: (signal?: AbortSignal) => void
}
