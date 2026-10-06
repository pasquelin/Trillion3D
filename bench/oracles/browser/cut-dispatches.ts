/**
 * The cut from BEFORE the "persistent selection" batch, copied whole: its descent kernel, the
 * layout of its work buffer, its buffers and its encoding. Two toggling queues, whose
 * counter can only restart from zero by a CPU copy, and an arming of the indirect argument
 * per level.
 *
 * This is the ORACLE of `tests/gpu/dag/cut-dispatches.gpu.ts`. It is copied — not imported — for the
 * reason that makes an oracle: it must stay what the deposit did at `develop`, whatever
 * happens to the shipped code. The shipped side is never copied: the bench calls
 * `encodeDagKernels` and `createDagResources` for real, otherwise it would measure a copy
 * of the cut instead of it.
 *
 * Its offsets in `work` are those from before: each queue carries a counter AND a group
 * count, since it was read indirectly, and everything that follows is shifted by that. What
 * surrounds the descent — prepare, candidates, mask, compaction, request sort — is the shipped
 * kernels, so the oracle follows their layout and their stages: the cut rule decides in the mask,
 * with no escalation round before it.
 */
import { SELECTION_WORKGROUP } from '../../../packages/sdk-browser/src/gpu/core/selection.ts'
import { namedBufferEntries } from '../../../packages/sdk-browser/src/gpu/core/computeBindings.ts'
import { DAG_BINDING } from '../../../packages/sdk-browser/src/gpu/dag/shader/bindings.ts'
import { DAG_UNIFORM_BYTES } from '../../../packages/sdk-browser/src/gpu/dag/shader/viewsWgsl.ts'
import { dagFlagsWords } from '../../../packages/sdk-browser/src/gpu/dag/shader/lastUseWgsl.ts'
import { dagWorkLayout } from '../../../packages/sdk-browser/src/gpu/dag/shader/floorWgsl.ts'
import { primitiveFrameWords } from '../../../packages/sdk-browser/src/gpu/dag/worlds.ts'
import { framesBytes } from '../../../packages/sdk-browser/src/gpu/dag/frameRanges.ts'
import { worldBufferWords } from '../../../packages/sdk-browser/src/gpu/dag/worldBuffer.fixture.ts'
import type { PackedDag } from '../../../packages/sdk-browser/src/gpu/dag/types.ts'
import {
  selectionListCap,
  stagedOutputBytes,
} from '../../../packages/sdk-browser/src/gpu/dag/layout.ts'

/** What `resourcesBefore` reads of the bench's packed scene: the same fields the shipped
 *  `createDagResources` reads, before the batch renamed and reshaped a few of them. */
interface PackedBefore {
  pageCount: number
  worldCount: number
  clusters: BufferSource
  nodes: BufferSource
  nodeCount: number
  worldStretch: Float32Array
  rootNodes: Uint32Array
  recordShift: Uint32Array
  worlds: Float32Array
  worldSources: PackedDag['worldSources']
  pageCones: BufferSource
  levelSizes: readonly unknown[]
}

const KERNELS_BEFORE = [
  'dagPrepare',
  'dagClearDrawn',
  'dagWanted',
  'dagMask',
  'dagDrawPrefix',
  'dagDrawScatter',
  'dagSortRequests',
]

/** The `range` words of a `frames` that holds all `worldCount` primitives. */
const wholeRange = (worldCount: number) => new Uint32Array([0, worldCount, 0, 0])

/** Buffers, steps and offsets of the previous cut, mounted on the bench's `packed`. */
export function resourcesBefore(
  device: GPUDevice,
  module: GPUShaderModule,
  layout: GPUBindGroupLayout,
  packed: PackedBefore,
) {
  const pageCount = packed.pageCount,
    worldCount = Math.max(1, packed.worldCount)
  const blockCount = Math.ceil(pageCount / SELECTION_WORKGROUP)
  // The frozen counters run from `base` to `base + 9`, whose last word is the shipped first per-view
  // word: `dagPrepare` zeroes it as `resetCounters` does, and only a light cut counts in it.
  const { base, words } = dagWorkLayout(blockCount)
  const STORAGE = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
  // The frame words are the shipped ones: the frozen descent reads the same records.
  const frameData = primitiveFrameWords(packed)
  const storage = (size: number, source?: BufferSource | null, usage = STORAGE) => {
    const buffer = device.createBuffer({ size: Math.max(size, source?.byteLength ?? 0), usage })
    if (source) device.queue.writeBuffer(buffer, 0, source)
    return buffer
  }
  // Only the descent is frozen: the rest of the shader, and so its group 0, is the shipped one,
  // so each buffer sits under its WGSL name and `namedBufferEntries` lays it at that binding.
  const buffers = {
    clusters: { buffer: storage(64, packed.clusters) },
    nodes: { buffer: storage(64, packed.nodes) },
    // The uniform array, and the per-view words and widest-view word the shipped prepare resets,
    // around the frozen descent.
    views: {
      buffer: storage(DAG_UNIFORM_BYTES, null, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST),
    },
    // Sized by the shipped rule: the shipped stages address words past the frozen two queues —
    // each page's last use sits behind a third (`lastUseWgsl.ts`).
    flags: { buffer: storage(Math.max(16, dagFlagsWords(packed.nodeCount, pageCount) * 4)) },
    // The shipped `dagWanted` stages the camera's requests behind the drawn list, where the
    // shipped `dagSortRequests` reads them (`gpu/dag/shader/snapshotWgsl.ts`).
    out: { buffer: storage(stagedOutputBytes(selectionListCap(pageCount))) },
    work: { buffer: storage(words * 4) },
    // The matrices, then each source's exact origin, as one range of the shipped cut holds them.
    worlds: { buffer: storage(64, worldBufferWords(packed.worlds, packed.worldSources)) },
    // The host's row, then what the shipped `dagPrepare` derives per primitive behind it.
    frames: { buffer: storage(framesBytes(worldCount), frameData) },
    cold: { buffer: storage(48, packed.pageCones) },
    // One range holds every primitive (`frameRanges.ts`).
    range: {
      buffer: storage(16, wholeRange(worldCount), GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST),
    },
  }
  const dispatchArgs = device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(dispatchArgs, 0, new Uint32Array([0, 1, 1, 0]))
  const zeros = device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_SRC })
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] })
  const pipelineOf = (entryPoint: string) =>
    device.createComputePipeline({ layout: pipelineLayout, compute: { module, entryPoint } })
  return {
    uniforms: buffers.views.buffer,
    output: buffers.out.buffer,
    work: buffers.work.buffer,
    dispatchArgs,
    zeros,
    worldCount,
    blockCount,
    levelCount: packed.levelSizes.length,
    queueResetOffset: [(base + 2) * 4, (base + 4) * 4],
    queueGroupsOffset: [(base + 3) * 4, (base + 5) * 4],
    candGroupsOffset: (base + 7) * 4,
    liveGroupsOffset: (base + 1) * 4,
    drawnGroupsOffset: (base + 9) * 4,
    kernels: Object.fromEntries(KERNELS_BEFORE.map((name) => [name, pipelineOf(name)])),
    levels: [pipelineOf('dagLevel0'), pipelineOf('dagLevel1')],
    bindGroup: device.createBindGroup({
      layout,
      entries: namedBufferEntries(DAG_BINDING, buffers),
    }),
  }
}

/** Encoding of a frame as `packages/sdk-browser/src/gpu/dag/encode.ts` wrote it at `develop`, resident cut. */
export function encodeBefore(
  encoder: GPUCommandEncoder,
  r: ReturnType<typeof resourcesBefore>,
  depth = r.levelCount,
) {
  const { bindGroup, dispatchArgs, work, zeros, kernels, levels } = r
  const groups = (n: number) => Math.max(1, Math.ceil(n / SELECTION_WORKGROUP))
  const arm = (bytes: number) => encoder.copyBufferToBuffer(work, bytes, dispatchArgs, 0, 4)
  const alone = (pipeline: GPUComputePipeline) => {
    const pass = encoder.beginComputePass()
    pass.setBindGroup(0, bindGroup)
    pass.setPipeline(pipeline)
    pass.dispatchWorkgroupsIndirect(dispatchArgs, 0)
    pass.end()
  }
  arm(r.drawnGroupsOffset)
  const head = encoder.beginComputePass()
  head.setBindGroup(0, bindGroup)
  head.setPipeline(kernels.dagClearDrawn)
  head.dispatchWorkgroupsIndirect(dispatchArgs, 0)
  head.setPipeline(kernels.dagPrepare)
  head.dispatchWorkgroups(groups(Math.max(r.worldCount, r.blockCount)))
  head.setPipeline(levels[0])
  head.dispatchWorkgroups(groups(r.worldCount))
  head.end()
  for (let level = 1; level < depth; level++) {
    const source = level & 1
    encoder.copyBufferToBuffer(zeros, 0, work, r.queueResetOffset[1 - source], 8)
    arm(r.queueGroupsOffset[source])
    alone(levels[source])
  }
  arm(r.candGroupsOffset)
  alone(kernels.dagWanted)
  arm(r.liveGroupsOffset)
  const live = encoder.beginComputePass()
  live.setBindGroup(0, bindGroup)
  const onList = (pipeline: GPUComputePipeline) => {
    live.setPipeline(pipeline)
    live.dispatchWorkgroupsIndirect(dispatchArgs, 0)
  }
  onList(kernels.dagMask)
  live.setPipeline(kernels.dagDrawPrefix)
  live.dispatchWorkgroups(1)
  onList(kernels.dagDrawScatter)
  live.setPipeline(kernels.dagSortRequests)
  live.dispatchWorkgroups(1)
  live.end()
}
