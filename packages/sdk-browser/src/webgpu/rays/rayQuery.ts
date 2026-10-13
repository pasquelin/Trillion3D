import type { CutTables, GpuSelection } from '../../gpu/core/selection.ts'
import { nodeLayout } from '../../gpu/dag/treeRefit.ts'
import { DAG_BINDING, dagPartEntries } from '../../gpu/dag/shader/bindings.ts'
import { childBase } from '../../gpu/dag/layout.ts'
import { oncePerDevice } from '../../gpu/core/oncePerDevice.ts'
import { sequentialEntries } from '../../gpu/core/computeBindings.ts'
import { dispatchRows, groupWidth } from '../../gpu/dispatch/grid.ts'
import { preparedComputePipeline, preparedPipelines } from '../../lighting/deferred/fullscreen.ts'
import { alignUp, ceilDiv, nextPow2 } from '../../../../math/src/scalar/integers.ts'
import { NO_INDEX } from '../../../../math/src/constants.ts'
import { RAY_HIT } from './rayRecord.ts'
import { RAY_LANES, rayQueryWgsl } from './rayQueryWgsl.ts'
import type { RayLayout } from './rayPlacementWgsl.ts'
import { RAY_PARAMS, ROW_HASH_SHADER } from './rowHashWgsl.ts'

const RAY_QUERY_PASS = 'Trillion3D ray query'

/** What a batch of rays reads where it lies: the cut's tables and ranges, the page table and its
 *  visibility rows, the geometry pool's words and the float pool. */
export type RaySources = {
  tables: CutTables
  ranges: GpuSelection['worldRanges']
  pageTable: GPUBuffer
  geometry: GPUBuffer
  positions: GPUBuffer
  rows: number
}

/** A batch: its rays' records then their filter lists, as words (`rayRecord.ts`), and its rays. */
type RayBatch = { words: Uint32Array; rays: number; filterWord: number }

/** How `sources` lay the cut's tables out on the device: what a trace kernel is made for. */
const layoutOf = ({ tables, ranges }: RaySources): RayLayout => ({
  nodes: nodeLayout(tables.nodeParts),
  cold: { per: tables.coldParts.bytes / 4, parts: tables.coldParts.buffers.length },
  ranges: ranges.map(({ first, count }) => ({ first, count })),
})

/** A compute pipeline of the query on `module`, prepared off the frame. */
const computeOf = (device: GPUDevice, module: GPUShaderModule, entryPoint: string) =>
  preparedComputePipeline(device, {
    label: RAY_QUERY_PASS,
    layout: 'auto',
    compute: { module, entryPoint },
  })

/** The trace kernels of a device, one a layout, and its row index kernel, each made once. */
const traceKernels = oncePerDevice((device: GPUDevice) =>
  preparedPipelines(
    (layout: RayLayout) =>
      computeOf(
        device,
        device.createShaderModule({ label: RAY_QUERY_PASS, code: rayQueryWgsl(layout) }),
        'traceRays',
      ),
    (layout) => JSON.stringify(layout),
  ),
)
const hashKernel = oncePerDevice((device: GPUDevice) =>
  computeOf(
    device,
    device.createShaderModule({ label: RAY_QUERY_PASS, code: ROW_HASH_SHADER }),
    'insertRows',
  ),
)

/** Slots of the row index over `rows` rows: twice them at least, a power of two. */
const indexSlots = (rows: number) => nextPow2(Math.max(32, 2 * rows))

/**
 * THE RAY QUERY ON ONE DEVICE: a batch of rays encoded as two dispatches of one compute pass —
 * the row index made from the page table (`rowHashWgsl.ts`), then a thread a ray
 * (`rayQueryWgsl.ts`) — into a buffer of its own, grown to the largest batch: the rays, their filter
 * lists, their hits, then the index. Nothing waits: `encode` answers where the hits lie for the
 * caller's copy, or nothing while a kernel compiles (`compiled`).
 */
export function createRayQuery(device: GPUDevice) {
  const params = device.createBuffer({
    label: RAY_QUERY_PASS,
    size: RAY_PARAMS.words * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const paramWords = new Uint32Array(RAY_PARAMS.words)
  let query: GPUBuffer | undefined
  /** The query's buffer, of `bytes` at least. */
  const queryOf = (bytes: number) => {
    if (query && query.size >= bytes) return query
    query?.destroy()
    return (query = device.createBuffer({
      label: RAY_QUERY_PASS,
      size: nextPow2(Math.max(256, bytes)),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    }))
  }
  return {
    /** Whether both kernels for `sources` are compiled: when not, their compile is started and
     *  `then` is called once it lands — `failed` if the device refuses it. */
    compiled(sources: RaySources, then: () => void, failed: () => void) {
      const kernels = [traceKernels(device).of(layoutOf(sources)), hashKernel(device)]
      if (kernels.every((kernel) => kernel.ready)) return true
      Promise.all(kernels.map((kernel) => kernel.prepare())).then(then, failed)
      return false
    },
    /** Encodes `batch` into `encoder` over `sources`; returns where its hits lie in `buffer`. */
    encode(encoder: GPUCommandEncoder, sources: RaySources, batch: RayBatch) {
      const trace = traceKernels(device).of(layoutOf(sources)).get(),
        hash = hashKernel(device).get()
      const slots = indexSlots(sources.rows),
        hitWord = batch.words.length,
        hashWord = alignUp(hitWord + batch.rays * RAY_HIT.words, 2)
      const buffer = queryOf((hashWord + 2 * slots) * 4)
      device.queue.writeBuffer(buffer, 0, batch.words)
      writeParams(paramWords, sources, batch, { hitWord, hashWord, slots })
      device.queue.writeBuffer(params, 0, paramWords)
      encoder.clearBuffer(buffer, hashWord * 4, slots * 8)
      const width = groupWidth(device.limits)
      const pass = encoder.beginComputePass({ label: RAY_QUERY_PASS })
      // No row, no index: a dispatch of no workgroup is refused, and every lookup finds none.
      if (sources.rows > 0) {
        pass.setPipeline(hash)
        pass.setBindGroup(0, groupOf(device, hash, 0, [params, buffer, sources.pageTable]))
        dispatchRows(pass, ceilDiv(sources.rows, 64), 1, width)
      }
      pass.setPipeline(trace)
      pass.setBindGroup(0, tablesGroup(device, trace, sources.tables))
      const perRange = sources.ranges.flatMap(({ frames, buffer: worlds }) => [frames, worlds])
      const own = [params, buffer, sources.pageTable, sources.geometry, sources.positions]
      pass.setBindGroup(1, groupOf(device, trace, 1, [...own, ...perRange]))
      dispatchRows(pass, ceilDiv(batch.rays, RAY_LANES), 1, width)
      pass.end()
      return { buffer, offset: hitWord * 4, bytes: batch.rays * RAY_HIT.words * 4 }
    },
    dispose() {
      params.destroy()
      query?.destroy()
    },
  }
}
export type RayQuery = ReturnType<typeof createRayQuery>

/** The uniform of a batch (`RAY_PARAMS`). */
function writeParams(
  words: Uint32Array,
  { tables, rows }: RaySources,
  { rays, filterWord }: RayBatch,
  at: { hitWord: number; hashWord: number; slots: number },
) {
  const P = RAY_PARAMS.at
  words[P.rays] = rays
  words[P.rayWord] = 0
  words[P.hitWord] = at.hitWord
  words[P.filterWord] = filterWord
  words[P.hashWord] = at.hashWord
  words[P.hashMask] = at.slots - 1
  words[P.rows] = rows
  words[P.childBase] = childBase(tables.pageCount)
  words[P.treeRoot] = tables.tree ? tables.tree.levels[0].base : NO_INDEX
  words[P.members] = tables.tree?.members ?? 0
  words[P.placements] = tables.placements
  words[P.worldPlacement] = tables.worldPlacement
}

/** Group `group` of `pipeline`, its buffers at bindings 0 on. */
const groupOf = (
  device: GPUDevice,
  pipeline: GPUComputePipeline,
  group: number,
  buffers: GPUBuffer[],
) =>
  device.createBindGroup({
    layout: pipeline.getBindGroupLayout(group),
    entries: sequentialEntries(buffers.map((buffer) => ({ buffer }))),
  })

/** Group 0 of the trace: the cut's nodes and cold table at the cut's bindings, their parts after. */
const tablesGroup = (device: GPUDevice, pipeline: GPUComputePipeline, t: CutTables) =>
  device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: DAG_BINDING.nodes, resource: { buffer: t.nodeParts.buffers[0] } },
      { binding: DAG_BINDING.cold, resource: { buffer: t.coldParts.buffers[0] } },
      ...dagPartEntries({
        nodes: t.nodeParts.buffers.slice(1),
        cold: t.coldParts.buffers.slice(1),
      }),
    ],
  })
