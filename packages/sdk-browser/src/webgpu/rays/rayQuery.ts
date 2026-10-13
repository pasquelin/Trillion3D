import { copyParts } from '../../gpu/dag/split.ts'
import { uniformStride } from '../../residency/pools.ts'
import { alignUp, nextPow2 } from '../../../../math/src/scalar/integers.ts'
import { NO_INDEX } from '../../../../math/src/constants.ts'
import { RAY_HIT } from './rayRecord.ts'
import type { RayRecords } from './rayRecords.ts'
import { DEFORM_SLOT_WORDS, RAY_PARAMS } from './deformIndexWgsl.ts'
import {
  encodeRayPass,
  RAY_QUERY_PASS,
  rayKernelsCompiled,
  type RayBatch,
  type RaySources,
} from './rayQueryPass.ts'

/** Where a batch lies in the query's buffer, in words: the records first, kept from batch to batch,
 *  the tree's member order, the rays and their filters, the hits, then the deformation index. */
function queryLayout({ tables, records, rows, entryCount }: RaySources, batch: RayBatch) {
  const memberWord = records.words.length,
    rayWord = memberWord + (tables.tree?.capacity ?? 0),
    hitWord = rayWord + batch.words.length,
    hashWord = alignUp(hitWord + batch.rays * RAY_HIT.words, DEFORM_SLOT_WORDS),
    slots = nextPow2(Math.max(32, 2 * (rows + entryCount)))
  return {
    memberWord,
    rayWord,
    hitWord,
    hashWord,
    slots,
    words: hashWord + DEFORM_SLOT_WORDS * slots,
  }
}
type QueryLayout = ReturnType<typeof queryLayout>

/**
 * THE RAY QUERY ON ONE DEVICE: a batch of rays encoded in one compute pass — the deformation index
 * made from the rows and the spans (`deformIndexWgsl.ts`), then a dispatch a range of placements
 * (`rayQueryWgsl.ts`), each carrying the hits the one before left — over a buffer of its own: the
 * records a ray decodes (`rayRecords.ts`), kept and written as they move, then what the batch
 * brings. A trace binds the cut's nodes and five storage buffers whatever the world's ranges and the
 * cold table's parts — the member order is copied in. Nothing waits: `encode` answers where the
 * hits lie for the caller's copy; `compiled` says whether the kernels are made yet.
 */
export function createRayQuery(device: GPUDevice) {
  const stride = uniformStride(device.limits),
    paramWords = new Uint32Array(RAY_PARAMS.words)
  let query: GPUBuffer | undefined, params: GPUBuffer | undefined, recordsIn: GPUBuffer | undefined
  /** The query's buffer, of `bytes` at least: the records written whole into a new one. */
  const queryOf = (bytes: number) => {
    if (query && query.size >= bytes) return query
    query?.destroy()
    return (query = device.createBuffer({
      label: RAY_QUERY_PASS,
      size: nextPow2(Math.max(256, bytes)),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    }))
  }
  /** The parameters' slots, one a range. */
  const paramsOf = (ranges: number) => {
    if (params && params.size >= ranges * stride) return params
    params?.destroy()
    return (params = device.createBuffer({
      label: RAY_QUERY_PASS,
      size: Math.max(1, ranges) * stride,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    }))
  }
  return {
    /** Whether both kernels for `sources` are compiled: when not, their compile is started and
     *  `then` is called once it lands — `failed` if the device refuses it. */
    compiled: (sources: RaySources, then: () => void, failed: () => void) =>
      rayKernelsCompiled(device, sources, then, failed),
    /** Encodes `batch` into `encoder` over `sources`; returns where its hits lie in `buffer`. */
    encode(encoder: GPUCommandEncoder, sources: RaySources, batch: RayBatch) {
      const rebuilt = sources.records.sync(sources.tables)
      const at = queryLayout(sources, batch),
        buffer = queryOf(at.words * 4),
        slots = paramsOf(sources.ranges.length)
      writeRecords(device, sources.records, buffer, rebuilt || buffer !== recordsIn)
      recordsIn = buffer
      device.queue.writeBuffer(buffer, at.rayWord * 4, batch.words)
      sources.ranges.forEach((range, r) => {
        writeParams(paramWords, sources, batch, at, { ...range, carry: r > 0 })
        device.queue.writeBuffer(slots, r * stride, paramWords)
      })
      const tree = sources.tables.tree
      if (tree)
        copyParts(
          encoder,
          sources.tables.coldParts,
          tree.members * 4,
          buffer,
          at.memberWord * 4,
          tree.capacity * 4,
        )
      encoder.clearBuffer(buffer, at.hashWord * 4, at.slots * DEFORM_SLOT_WORDS * 4)
      encodeRayPass(device, encoder, sources, { buffer, slots, stride, rays: batch.rays })
      return { buffer, offset: at.hitWord * 4, bytes: batch.rays * RAY_HIT.words * 4 }
    },
    dispose() {
      params?.destroy()
      query?.destroy()
    },
  }
}
export type RayQuery = ReturnType<typeof createRayQuery>

/** The records into the query's buffer: every one into a new buffer or a table built anew, else
 *  the runs written since. */
function writeRecords(device: GPUDevice, records: RayRecords, buffer: GPUBuffer, whole: boolean) {
  const runs = records.takeDirty(),
    { words } = records
  if (whole) return device.queue.writeBuffer(buffer, 0, words)
  for (let i = 0; i < runs.length;) {
    const first = runs[i]
    let end = first + 1
    while (++i < runs.length && runs[i] === end) end++
    device.queue.writeBuffer(buffer, first * 16, words, first * 4, (end - first) * 4)
  }
}

/** The uniform of one range's dispatch (`RAY_PARAMS`). */
function writeParams(
  words: Uint32Array,
  { tables, rows, entryCount }: RaySources,
  { rays, filterWord }: RayBatch,
  at: QueryLayout,
  range: { first: number; count: number; carry: boolean },
) {
  const P = RAY_PARAMS.at
  words[P.rays] = rays
  words[P.rayWord] = at.rayWord
  words[P.hitWord] = at.hitWord
  words[P.filterWord] = at.rayWord + filterWord
  words[P.recordWord] = 0
  words[P.memberWord] = at.memberWord
  words[P.hashWord] = at.hashWord
  words[P.hashMask] = at.slots - 1
  words[P.rows] = rows
  words[P.entries] = entryCount
  words[P.treeRoot] = tables.tree ? tables.tree.levels[0].base : NO_INDEX
  words[P.placements] = tables.placements
  words[P.worldPlacement] = tables.worldPlacement
  words[P.rangeFirst] = range.first
  words[P.rangeCount] = range.count
  words[P.carry] = range.carry ? 1 : 0
}
