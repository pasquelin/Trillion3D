import { preparedComputeStage } from '../../gpu/core/computeStages.ts'
import { bufferEntries, computeBufferEntries } from '../../gpu/core/computeBindings.ts'
import { groupWidth, groupWidthConstants } from '../../gpu/dispatch/grid.ts'
import { heldGroup } from '../../gpu/bind/bindIdentity.ts'
import { RASTER_PASSES, type RasterPass } from '../raster/contract.ts'
import { DECODE_ARGS_BYTES, decodeArgsAt, visWorkLayout } from '../decode/contract.ts'
import { BIN_PARAMS, binsSource } from './binsWgsl.ts'
import {
  BIN_UNIFORM_BYTES,
  binGroups,
  binScratch,
  drawBatches,
  drawIndirectBytes,
  slotCount,
} from './contract.ts'

/** The bins' bindings' kinds, in their order (`BIN_BINDING`): the decoded clusters and the list of
 *  visible clusters are read, the work buffer, the outputs and the lists written, then the uniform. */
const KINDS = [
  'read-only-storage',
  'read-only-storage',
  'storage',
  'storage',
  'storage',
  'storage',
  'storage',
  'uniform',
] as const satisfies readonly GPUBufferBindingType[]

/**
 * The stages of the bins (`binsWgsl.ts`) for `layerSlots` coplanar layers: the count, the
 * reservation, the scatter and the finalizing of each pass of the cut, compiled once; the buffers
 * they work on follow the cut's list (`createGpuBins`).
 */
export function createBinStages(device: GPUDevice, layerSlots: number) {
  const layout = device.createBindGroupLayout({ entries: computeBufferEntries(KINDS) })
  const module = device.createShaderModule({
    label: 'Trillion3D raster bins',
    code: binsSource(layerSlots),
  })
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] })
  const constants = groupWidthConstants(groupWidth(device.limits))
  const stage = (entry: string, pass: RasterPass) =>
    preparedComputeStage(device, pipelineLayout, module, entry, { PASS: pass, ...constants }).ask()
  const stages = RASTER_PASSES.map((pass) => ({
    count: stage('binCount', pass),
    reserve: stage('binReserve', pass),
    scatter: stage('binScatter', pass),
    finalize: stage('binFinalize', pass),
  }))
  return {
    layout,
    stages,
    layerSlots,
    slots: slotCount(layerSlots),
    /** Whether every stage is compiled. */
    get ready() {
      return stages.every(
        (s) => s.count.ready && s.reserve.ready && s.scatter.ready && s.finalize.ready,
      )
    },
    /** The stages of `pass`'s bins, for `chainReady`. */
    chain: (pass: RasterPass) => {
      const s = stages[pass]!
      return [s.count, s.reserve, s.scatter, s.finalize]
    },
    /** Settles once every stage is compiled; rejects when the device refuses one. */
    prepare: () =>
      Promise.all(
        stages.flatMap((s) => [s.count, s.reserve, s.scatter, s.finalize].map((p) => p.prepare())),
      ),
  }
}
export type BinStages = ReturnType<typeof createBinStages>

/** What the bins of a pass read and write that the cut and the raster own: the decoded clusters,
 *  the list of visible clusters and the raster's lists. */
export type BinInputs = { pages: GPUBuffer; visible: GPUBuffer; lists: GPUBuffer }

/** What the image asks of the bins: whether the x-ray view walks the software raster's clusters in
 *  the hardware slots too. */
type BinOptions = { softwareSlots: boolean }

/** The bins of a list of `cap` visible clusters (`createGpuBins`), as the passes read them. */
export type GpuBins = {
  /** Draw commands, one per slot (`drawIndirectBytes`). */
  indirectBuffer: GPUBuffer
  /** The instance words of the hardware slots (`INSTANCE_WORD_WGSL`), `cap × perRow` of them. */
  instanceBuffer: GPUBuffer
  /** Where each slot's first instance lies in `instanceBuffer`, one word a slot: what the hardware
   *  raster reads (`slotOffsets`). */
  slotOffsetBuffer: GPUBuffer
  /** The work buffer the decode, the bins and the deformation share (`../decode/contract.ts`). */
  workBuffer: GPUBuffer
  /** The dispatch of each pass's decode and bins, which the plan writes (`DECODE_ARGS_BYTES`): the
   *  only buffer the bins' dispatches read their arguments from. */
  argsBuffer: GPUBuffer
  /** The clusters the list holds room for, which the buffers are sized by. */
  cap: number
  /** Slots these bins were built for: `slotCount(layerSlots)`. */
  slots: number
  /** Corners each instance launches, and instances a cluster takes at most (`drawBatches`). */
  corners: number
  perRow: number
  /** The image's options, sent when they changed. */
  write(options: BinOptions): void
  /** What a pass counts in zeroed, before its compute pass. */
  clear(encoder: GPUCommandEncoder): void
  /** `pass`'s bins in `compute`, once its decode (`../decode/decode.ts`) and its deformation. */
  encode(compute: GPUComputePassEncoder, pass: RasterPass, inputs: BinInputs): void
  dispose(): void
}

/** The buffers of the bins: the hardware raster's instances, commands and slot offsets, the work
 *  buffer, the dispatch arguments and the uniform. */
function createBinBuffers(
  device: GPUDevice,
  slots: number,
  cap: number,
  perRow: number,
  workWords: number,
) {
  const STORAGE = GPUBufferUsage.STORAGE
  const instanceBuffer = device.createBuffer({
    label: 'Trillion3D raster instances',
    size: Math.max(4, cap * perRow * 4),
    usage: STORAGE | GPUBufferUsage.COPY_SRC,
  })
  const indirectBuffer = device.createBuffer({
    label: 'Trillion3D raster commands',
    size: drawIndirectBytes(slots),
    usage: GPUBufferUsage.INDIRECT | STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
  })
  const slotOffsetBuffer = device.createBuffer({
    label: 'Trillion3D raster slot offsets',
    size: slots * 4,
    usage: STORAGE,
  })
  const workBuffer = device.createBuffer({
    label: 'Trillion3D visibility work',
    size: workWords * 4,
    usage: STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST,
  })
  const argsBuffer = device.createBuffer({
    label: 'Trillion3D visibility dispatch',
    size: DECODE_ARGS_BYTES,
    usage: STORAGE | GPUBufferUsage.INDIRECT,
  })
  const uniform = device.createBuffer({
    label: 'Trillion3D raster bins uniform',
    size: BIN_UNIFORM_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  return { instanceBuffer, indirectBuffer, slotOffsetBuffer, workBuffer, argsBuffer, uniform }
}
type BinBuffers = ReturnType<typeof createBinBuffers>

/** The uniform's words as the image's options leave them, `held` what the GPU holds, and the word
 *  each parameter sits at. */
function binUniformWords(corners: number, perRow: number, cap: number, scratch: number) {
  const words = new Uint32Array(BIN_UNIFORM_BYTES / 4),
    held = new Uint32Array(BIN_UNIFORM_BYTES / 4)
  const at = Object.fromEntries(BIN_PARAMS.map((name, k) => [name, k])) as Record<
    (typeof BIN_PARAMS)[number],
    number
  >
  words[at.corners] = corners
  words[at.perRow] = perRow
  words[at.cap] = cap
  words[at.instanceCap] = cap * perRow
  words[at.scratch] = scratch
  return { words, held, at }
}

/** `pass`'s bins in `compute`: the group over the inputs, made again when one moved, then the four
 *  stages. */
function encodeBinPass(
  device: GPUDevice,
  stages: BinStages,
  buffers: BinBuffers,
  group: ReturnType<typeof heldGroup>,
  groups: number,
  compute: GPUComputePassEncoder,
  pass: RasterPass,
  inputs: BinInputs,
) {
  const { workBuffer, instanceBuffer, indirectBuffer, slotOffsetBuffer, argsBuffer, uniform } =
    buffers
  const { next } = group.identity
  next[0] = stages.layout
  next[1] = inputs.pages
  next[2] = inputs.visible
  next[3] = inputs.lists
  next[4] = workBuffer
  next.length = 5
  if (group.identity.moved())
    group.group = device.createBindGroup({
      layout: stages.layout,
      entries: bufferEntries([
        inputs.pages,
        inputs.visible,
        workBuffer,
        instanceBuffer,
        indirectBuffer,
        slotOffsetBuffer,
        inputs.lists,
        uniform,
      ]),
    })
  const s = stages.stages[pass]!
  const count = s.count.get(),
    reserve = s.reserve.get(),
    scatter = s.scatter.get(),
    finalize = s.finalize.get()
  if (!count || !reserve || !scatter || !finalize) return
  compute.setBindGroup(0, group.group!)
  compute.setPipeline(count)
  compute.dispatchWorkgroupsIndirect(argsBuffer, decodeArgsAt(pass))
  compute.setPipeline(reserve)
  compute.dispatchWorkgroups(groups)
  compute.setPipeline(scatter)
  compute.dispatchWorkgroupsIndirect(argsBuffer, decodeArgsAt(pass))
  compute.setPipeline(finalize)
  compute.dispatchWorkgroups(1)
}

/**
 * The bins for a list of `cap` visible clusters on `stages`: the work buffer the decode, the bins and
 * the deformation share (`../decode/contract.ts`), the hardware raster's instances, commands and slot
 * offsets (`GpuBins`), and the uniform. `maxCorners` is the catalogue's widest page, which fixes the
 * instances' batches (`drawBatches`). Made again when the list's room or the layers change; nothing
 * of an image is held in them across images.
 */
export function createGpuBins(
  device: GPUDevice,
  stages: BinStages,
  cap: number,
  maxCorners: number,
): GpuBins {
  const { slots } = stages,
    { corners, perRow } = drawBatches(maxCorners)
  const layout = visWorkLayout(slots, cap)
  const groups = binGroups(slots).total
  const buffers = createBinBuffers(device, slots, cap, perRow, layout.words)
  const { indirectBuffer, instanceBuffer, slotOffsetBuffer, workBuffer, argsBuffer, uniform } =
    buffers
  const { words, held, at } = binUniformWords(corners, perRow, cap, layout.scratch)
  const group = heldGroup()
  const scratchBytes = binScratch(slots).words * 4
  return {
    indirectBuffer,
    instanceBuffer,
    slotOffsetBuffer,
    workBuffer,
    argsBuffer,
    cap,
    slots,
    corners,
    perRow,
    write(options) {
      words[at.softwareSlots] = options.softwareSlots ? 1 : 0
      for (let k = 0; k < words.length; k++)
        if (words[k] !== held[k]) {
          device.queue.writeBuffer(uniform, 0, words)
          held.set(words)
          break
        }
    },
    /** What a pass counts in is zeroed before it. */
    clear(encoder) {
      encoder.clearBuffer(workBuffer, layout.scratch * 4, scratchBytes)
    },
    encode: (compute, pass, inputs) =>
      encodeBinPass(device, stages, buffers, group, groups, compute, pass, inputs),
    dispose() {
      instanceBuffer.destroy()
      indirectBuffer.destroy()
      slotOffsetBuffer.destroy()
      workBuffer.destroy()
      argsBuffer.destroy()
      uniform.destroy()
    },
  }
}
