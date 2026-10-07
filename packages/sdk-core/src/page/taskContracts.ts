import type { Page } from '../contracts/geometry.ts'
import type { readCellPage } from '../scene/core/tablePartition.ts'

/**
 * Off-main-thread page-task contract, version 9: `cut` turns drawn triangles into pages, which
 * come back as bytes with their descriptors and their normal cone, the packed triangles carrying
 * whether their pages keep one; `cells` reads a partition's cell file into the rows it places, and
 * `cellPage` a page of its cell index (#575). No geometry page is decoded on the CPU: the GPU reads
 * it in place (#1483), and a fetched page's digest is taken where it lands (`crypto.subtle`, which
 * runs off the main thread already).
 *
 * The calling thread sends a `PageTaskRequest`, the executor returns a `PageTaskAnswer` carrying
 * the same `id`. Nothing here touches the platform: no `Worker`, no fetch, no clock — the browser
 * adapter carries all of that, this file only carries the message shape, the closed list of
 * failures and the pool bound.
 *
 * Buffer ownership: `source` is **transferred** with the request, so the sender no longer owns
 * it; a response transfers the buffers it made. An executor that transfers nothing (the
 * synchronous fallback) returns exactly the same values: the contract does not say how the work
 * travels, only what it returns.
 */
export const PAGE_TASK_PROTOCOL = 9

/** `cut`: drawn triangles, packed as five lengths, whether their pages keep a cone, whether a
 *  blended material wears them, then five four-byte arrays (`packDrawn`), cut into pages. `cells`:
 *  a partition's cell file, read into each node's parent, mesh and local matrix. `cellPage`: a page
 *  of its cell index, read into the pages it lists or its cells. */
export type PageTaskOp = 'cut' | 'cells' | 'cellPage'

/** One page a `cut` wrote: its index and geometry bytes, their digests, and its descriptor. */
export interface PageCutPage {
  /** The triangle indices. */ index: ArrayBuffer
  /** The vertex bytes. */ geometry: ArrayBuffer
  /** Fingerprint of the indices. */ indexSha256: string
  /** Fingerprint of the vertices. */ geometrySha256: string
  /** Triangles in the page. */ count: number
  /** Its first source triangle. */ start: number
  /** Lowest corner. */ min: number[]
  /** Highest corner. */ max: number[]
  /** Bounding ball. */ sphere: number[]
  /** Vertices in the page. */ vertexCount: number
  /** Indices in the page. */ indexCount: number
  /** Which attributes it carries. */ flags: number
  /** Its size once unpacked. */ uncompressedBytes: number
  /** The cone of its triangles' normals, when one was built. */
  cone?: Page['cone']
}
/** What a `cut` returns: its pages, and the grids they were quantized on. */
export interface PageCutPayload {
  /** The pages written. */ pages: PageCutPage[]
  /** Grid step of positions, as a power of two. */ positionExponent: number
  /** Grid step of texture coordinates, as a power of two. */ uvExponent: number
  /** Largest position error on that grid. */ maxPositionError: number
}

/** A message asking a worker to cut pages, or to read a partition's cells. */
export interface PageTaskRequest {
  /** Message format version. */ protocol: number
  /** Request number. */ id: number
  /** What to do. */ op: PageTaskOp
  /** Transferred with the message: the sender is no longer the owner. */
  source: ArrayBuffer
  /** `cells`, `cellPage`: the file the source was read from, which a refusal names. */
  name?: string
}

/** A worker's answer when a page request succeeded. */ export interface PageTaskDone {
  /** Message format version. */ protocol: number
  /** The request answered. */ id: number
  /** Always `true`. */ ok: true
  /** `cut`: the pages, their bytes transferred. Absent otherwise. */
  cut?: PageCutPayload
  /** `cells`: per node, its core parent's rank (`-1`: the scene root) and its mesh's in `ranks`,
   *  two 32-bit integers, and the local matrix the engine composes for its pose in `locals`,
   *  sixteen doubles; both transferred. Absent otherwise. */
  cells?: { nodes: number; ranks: ArrayBuffer; locals: ArrayBuffer }
  /** `cellPage`: the page's slots, or its cells (`readCellPage`). Absent otherwise. */
  cellPage?: ReturnType<typeof readCellPage>
  /** Task time, measured by the executor itself. */
  taskMs: number
}

/**
 * Failure semantics, closed list. `PAGE_TASK_FAILED` carries any task's own rejection (its named
 * refusal, when it has one, rides in `refusal`); `PAGE_TASK_WORKER` answers an executor that
 * vanished — the only one that sends the task to the main thread.
 */
export type PageTaskFailureCode = 'PAGE_TASK_FAILED' | 'PAGE_TASK_WORKER'

/** A worker's answer when a page request failed. */ export interface PageTaskFailed {
  /** Message format version. */ protocol: number
  /** The request answered. */ id: number
  /** Always `false`. */ ok: false
  /** Why it failed. */ code: PageTaskFailureCode
  /** The original message, as-is: the caller raises the same `Error` as the synchronous path. */
  message: string
  /** The code of the engine's named refusal the task met (`EngineError`), which the caller raises
   *  again by that code; absent for any other failure. */
  refusal?: string
}
/** A worker's answer to a page request: done or failed. */
export type PageTaskAnswer = PageTaskDone | PageTaskFailed

/**
 * Size of the page worker pool: never more than the cores the machine reports, never more than
 * the package ceiling, never more than the admission bound already in force on transfers, and
 * at least one. A missing or non-integer value equals a single executor: on a platform that
 * reports nothing, we do not invent parallelism.
 */
export function pageWorkerCount(
  hardwareConcurrency: number | undefined,
  admissionLimit: number,
  ceiling = 4,
) {
  const cores = Number.isSafeInteger(hardwareConcurrency) ? (hardwareConcurrency as number) : 1
  const admission = Number.isSafeInteger(admissionLimit) ? admissionLimit : 1
  return Math.max(1, Math.min(cores, ceiling, admission))
}
