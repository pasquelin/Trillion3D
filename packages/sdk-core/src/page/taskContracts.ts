import type { CullingHierarchy } from '../contracts/geometry.ts'
import type { readCellPage } from '../scene/core/tablePartition.ts'

/**
 * Off-main-thread page-task contract, version 14: `cut` turns drawn triangles into pages, which
 * come back as bytes with their descriptors, in the order of the culling hierarchy that comes back
 * with them (version 10), each with the bytes it takes in the pool once installed (version 13);
 * `cells` reads a partition's cell file into the rows it places, each naming the source node it
 * draws (version 14), `cellPage` a page of its cell index (#575), and `blocks` decodes a texture tile's BC blocks to RGBA8 for a
 * device that samples none (version 11, `texture/blockDecode.ts`). No geometry page is decoded on
 * the CPU: the GPU transcodes it into the pool and reads it in place (#1483), and a fetched
 * page's digest is taken where it lands (`crypto.subtle`, which runs off the main thread already).
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
export const PAGE_TASK_PROTOCOL = 14

/** `cut`: drawn triangles, packed as five lengths, whether they are faces, whether a blended
 *  material wears them, then five four-byte arrays (`packDrawn`), cut into pages. `cells`:
 *  a partition's cell file, read into each node's parent, mesh, local matrix, track and whether it
 *  is drawn from its parent's own mesh. `cellPage`: a page
 *  of its cell index, read into the pages it lists or its cells. `blocks`: a tile record's BC7
 *  blocks — BC5 when `blocks.twoChannel` —, decoded to RGBA8. */
export type PageTaskOp = 'cut' | 'cells' | 'cellPage' | 'blocks'

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
  /** Bytes of the geometry page in the pool, once installed. */ residentBytes: number
  /** Vertices in the page. */ vertexCount: number
  /** Indices in the page. */ indexCount: number
  /** Which attributes it carries. */ flags: number
  /** Its size once unpacked. */ uncompressedBytes: number
}
/** What a `cut` returns: its pages. */
export interface PageCutPayload {
  /** The pages written, in the order of their culling hierarchy. */ pages: PageCutPage[]
  /** Their culling hierarchy, in the manifest's node layout (`page-codec-wasm/src/culling.rs`). */
  culling: CullingHierarchy
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
  /** `blocks`: the surface the blocks cover, in texels, and whether they are BC5. */
  blocks?: PageTaskBlocks
}
/** The surface a `blocks` task decodes. */
export type PageTaskBlocks = {
  /** Texels across. */ width: number
  /** Texels down. */ height: number
  /** BC5, X and Y with Z rebuilt, rather than BC7. */ twoChannel: boolean
  /** BC4, one channel, BC6H, half-float texels, or the eight-bit texels of a `gray` (`g8`) or
   *  `displacement` (`a8`) chain, rather than BC7 or BC5. */
  codec?: 'bc4' | 'bc6h' | 'g8' | 'a8' | 'rgba32f' | 'r32f' | 'r16f'
  /** One byte a texel — the channel alone — rather than RGBA8: the one-channel pool's. */
  single?: boolean
  /** The kind of texel the answer holds, when the float pools ask for another than the codec's
   *  own: `rgba32f`, `r32f` and `r16f` blocks (a float chain's) answer in it always. */
  to?: 'r8' | 'r16' | 'r32' | 'rgba8' | 'rgba16' | 'rgba32'
}

/** A worker's answer when a page request succeeded. */ export interface PageTaskDone {
  /** Message format version. */ protocol: number
  /** The request answered. */ id: number
  /** Always `true`. */ ok: true
  /** `cut`: the pages, their bytes transferred. Absent otherwise. */
  cut?: PageCutPayload
  /** `cells`: per node, its core parent's rank (`-1`: the scene root) and its mesh's in `ranks`,
   *  two 32-bit integers, the local matrix the engine composes for its pose in `locals`, sixteen
   *  doubles, the item of the scene's animation banks it plays in `tracks`, one 32-bit integer
   *  (`-1`: none), whether it is drawn from its parent's own host mesh in `sources`, one byte, the
   *  source node it draws in `sourceNodes`, one unsigned 32-bit integer, and
   *  the nearest and the farthest distance it is drawn at, and 1 for one instance of an instanced
   *  mesh, in `drawDistances`, three 32-bit floats (all 0: none), whether a view's primed depth draws it in `farFields`, one byte, whether it casts far shadows in `castFarShadows`, one byte, whether a sun's far-shadow test reaches it in `farShadowTests`, one byte (0: the view's rule decides, 1: it does, 2: it never does), and, for an
   *  instance of an assembly, the group that replaces the root of each primitive of its mesh in
   *  `rootParents`: seven 32-bit floats an entry — the node, the primitive, the error, the ball's
   *  centre and radius —, none for a cell that holds none; all transferred. Absent otherwise. */
  cells?: {
    nodes: number
    ranks: ArrayBuffer
    locals: ArrayBuffer
    tracks: ArrayBuffer
    sources: ArrayBuffer
    sourceNodes: ArrayBuffer
    drawDistances: ArrayBuffer
    farFields: ArrayBuffer
    castFarShadows: ArrayBuffer
    farShadowTests: ArrayBuffer
    rootParents: ArrayBuffer
  }
  /** `cellPage`: the page's slots, or its cells (`readCellPage`). Absent otherwise. */
  cellPage?: ReturnType<typeof readCellPage>
  /** `blocks`: the RGBA8 texels, whole blocks wide (`decodeBcLevel`), transferred. */
  texels?: ArrayBuffer
  /** Task time, measured by the executor itself. */
  taskMs: number
}

/**
 * Failure semantics, closed list. `PAGE_TASK_FAILED` carries any task's own rejection (its named
 * refusal, when it has one, rides in `refusal`); `PAGE_TASK_WORKER` answers an executor that
 * vanished — the only one that sends the task to the main thread.
 */
type PageTaskFailureCode = 'PAGE_TASK_FAILED' | 'PAGE_TASK_WORKER'

/** A worker's answer when a page request failed. */ interface PageTaskFailed {
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
