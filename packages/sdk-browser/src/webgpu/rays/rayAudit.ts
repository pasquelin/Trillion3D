import type { Ray } from '../../../../sdk-core/src/world/math/volumes.ts'
import { mapStaging } from '../../gpu/core/readbackRing.ts'
import {
  NODE_CHILD_COUNT,
  NODE_FIRST_CHILD,
  NODE_FIRST_PAGE,
  NODE_KIND,
  NODE_MAX,
  NODE_MIN,
  NODE_PAGE_COUNT,
} from '../../gpu/dag/nodeLayout.ts'
import { rootSource } from '../../placement/hidden.ts'
import { FLAG_CLUSTER_PAGE } from '../../visibility/types.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'
import { RAY_COUNT_WORDS, RAY_COUNTERS, RAY_DUMP_WORDS } from './rayCountWgsl.ts'
import { createRayQuery } from './rayQuery.ts'
import { prepareRayAudit, RAY_QUERY_PASS } from './rayQueryPass.ts'
import { sourcesOf } from './rayQueue.ts'
import { RAY_HIT, RAY_RECORD, RAY_REACH_MAX, readHit, writeRay } from './rayRecord.ts'
import { createRayRecords, RECORD_DRAWABLE, RECORD_NO_AREA, RECORD_WORDS } from './rayRecords.ts'

/** A double as the shaders hold it, high word then low word, back to a number. */
const doubleOf = (high: number, low: number) =>
  new Float64Array(new Uint32Array([low, high]).buffer)[0]

/** Each record's words as the host built them (`rayRecords.ts`): its slot, its bits, its geometry. */
const recordsOf = (words: Uint32Array) =>
  Array.from({ length: words.length / RECORD_WORDS }, (_, r) => {
    const at = r * RECORD_WORDS,
      flags = words[at + 1]
    return {
      record: r,
      slot: words[at] - 1,
      drawable: (flags & RECORD_DRAWABLE) !== 0,
      quantized: (flags & FLAG_CLUSTER_PAGE) !== 0,
      noArea: (flags & RECORD_NO_AREA) !== 0,
      vertexBase: words[at + 2],
      indexCount: words[at + 3],
    }
  })

/** Placement `w`'s words as the counting kernel read them on the GPU (`dumpTables`). */
function placementOf(rt: WebgpuPagesRuntime, words: Uint32Array, at: number, w: number) {
  const frame = words.subarray(at, at + 8),
    node = words.subarray(at + 8, at + 32),
    floats = new Float32Array(words.buffer, words.byteOffset + (at + 8) * 4, 24),
    origin = words.subarray(at + 48, at + 56),
    root = rt.layout.selectionRoots[w]
  return {
    placement: w,
    source: root ? (rootSource(root)?.name ?? null) : null,
    frame: {
      stretch: new Float32Array(frame.buffer, frame.byteOffset, 1)[0],
      ...{ root: frame[1], recordShift: frame[2], mark: frame[3], pageBase: frame[4] },
      ...{ heldBy: frame[5], pageCount: frame[6] },
    },
    rootNode: {
      min: [...floats.subarray(NODE_MIN, NODE_MIN + 3)],
      max: [...floats.subarray(NODE_MAX, NODE_MAX + 3)],
      ...{ firstChild: node[NODE_FIRST_CHILD], childCount: node[NODE_CHILD_COUNT] },
      ...{
        firstPage: node[NODE_FIRST_PAGE],
        pageCount: node[NODE_PAGE_COUNT],
        kind: node[NODE_KIND],
      },
    },
    matrix: [...new Float32Array(words.buffer, words.byteOffset + (at + 32) * 4, 16)],
    translation: [0, 2, 4].map((k) => doubleOf(origin[k], origin[k + 1])),
    treeTopChildren: words[at + 56],
  }
}

/**
 * THE RAY QUERY'S AUDIT: `rays` traced as a batch is, over the session's tables as they stand, by
 * the counting kernel (`rayCountWgsl.ts`) — each ray's hit and its work counted —, then what the
 * trace read of each placement dumped by the GPU where it reads it: the frame row, the root node,
 * the world. Beside them, the records the host built and the parameters. A proof's tool, none of
 * which exists until a host asks; `null` when the session cannot trace.
 */
export async function readRayAudit(rt: WebgpuPagesRuntime, rays: readonly Ray[]) {
  const device = rt.gpu.device,
    records = createRayRecords(rt),
    sources = device && !rt.run.lost ? sourcesOf(rt, records) : undefined
  if (!device || !sources || !rays.length) return null
  await prepareRayAudit(device)
  const filterWord = rays.length * RAY_RECORD.words,
    words = new Uint32Array(filterWord + 1),
    floats = new Float32Array(words.buffer)
  rays.forEach(({ origin: o, direction: d }, k) =>
    writeRay(words, floats, k * RAY_RECORD.words, {
      ...{ origin: [o.x, o.y, o.z], direction: [d.x, d.y, d.z], reach: RAY_REACH_MAX },
      ...{ filterFirst: 0, filterCount: 0, include: false },
    }),
  )
  const { placements } = sources.tables
  const countBytes = (rays.length * RAY_COUNT_WORDS + placements * RAY_DUMP_WORDS) * 4
  const made = (size: number, usage: number) =>
    device.createBuffer({ label: RAY_QUERY_PASS, size, usage })
  const counts = made(countBytes, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC),
    hitBytes = rays.length * RAY_HIT.words * 4,
    hitsRead = made(hitBytes, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST),
    countsRead = made(countBytes, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST)
  const query = createRayQuery(device),
    encoder = device.createCommandEncoder({ label: RAY_QUERY_PASS })
  const hits = query.encode(encoder, sources, { words, rays: rays.length, filterWord }, counts)
  encoder.copyBufferToBuffer(hits.buffer, hits.offset, hitsRead, 0, hitBytes)
  encoder.copyBufferToBuffer(counts, 0, countsRead, 0, countBytes)
  device.queue.submit([encoder.finish()])
  await Promise.all([mapStaging(hitsRead), mapStaging(countsRead)])
  const hitWords = new Uint32Array(hitsRead.getMappedRange().slice(0)),
    countWords = new Uint32Array(countsRead.getMappedRange().slice(0))
  for (const buffer of [hitsRead, countsRead, counts]) buffer.destroy()
  query.dispose()
  const { tables, rows, entryCount } = sources
  return {
    params: {
      ...{ treeRoot: tables.treeRoot, placements, worldPlacement: tables.worldPlacement },
      ...{ recordCount: tables.recordCount, rows, entryCount },
    },
    rays: rays.map((_, k) => {
      const at = k * RAY_COUNT_WORDS,
        counted = Object.fromEntries(RAY_COUNTERS.map((name, i) => [name, countWords[at + i]]))
      const best = new Float32Array(countWords.buffer, (at + RAY_COUNTERS.length) * 4, 1)[0]
      return {
        hit: readHit(hitWords, new Float32Array(hitWords.buffer), k * RAY_HIT.words),
        ...{ counted, best },
      }
    }),
    placements: Array.from({ length: placements }, (_, w) =>
      placementOf(rt, countWords, rays.length * RAY_COUNT_WORDS + w * RAY_DUMP_WORDS, w),
    ),
    records: recordsOf(records.words),
  }
}
export type RayAudit = NonNullable<Awaited<ReturnType<typeof readRayAudit>>>
