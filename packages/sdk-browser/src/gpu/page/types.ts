import type { createGpuPageReader } from './reader.ts'
import type { PageHomes } from './homes.ts'
import type { Eviction } from './eviction.ts'
import type { Placement } from './placement.ts'
import type { ResidencyLog } from './residencyLog.ts'

/** One page held in the GPU page pool. */
export interface ResidentPage {
  /** Its key. */
  key: string
  /** Its slot in the pool: its home's rank when the pool holds the whole catalogue (`homes.ts`). */
  slot: number
  /** Its byte offset. */
  offset: number
  /** Its size. */
  bytes: number
  /** How many times its slot was reused. */
  generation: number
}
export type GpuPageContext = {
  device: GPUDevice
  pageBytes: number
  slots: number
  /** Each page's own place, taken when `slots` hold the whole catalogue (`homes.ts`). */
  homes?: PageHomes
  buffer: GPUBuffer
  resident: Map<string, ResidentPage>
  /** The root cover's pages: a pool never goes below them (`resize.ts`). */
  cover: ReadonlySet<string>
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
    /** A load was refused for lack of a place since the host last asked (`takeRefused`). */
    refused: boolean
  }
  /** Which unpinned page gives its slot back, in fixed slots (`eviction.ts`). */
  eviction: Eviction
  /** Where an arrival lands: its home, a free slot or a victim's, and the slots free
   *  (`placement.ts`). */
  placement: Placement
  /** The changes the host has not drained yet (`residencyLog.ts`). */
  changes: ResidencyLog
  reader: ReturnType<typeof createGpuPageReader>
  check: (signal?: AbortSignal) => void
}
