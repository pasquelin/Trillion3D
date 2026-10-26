import { preparedComputeStage } from '../../gpu/core/computeStages.ts'
import { bufferEntries, computeBufferEntries } from '../../gpu/core/computeBindings.ts'
import { groupWidth, groupWidthConstants } from '../../gpu/dispatch/grid.ts'
import { heldGroup } from '../../gpu/bind/bindIdentity.ts'
import { RASTER_PASSES, type RasterPass } from '../raster/contract.ts'
import { decodeArgsAt } from './contract.ts'
import { decodePlanSource, decodeSource } from './decodeWgsl.ts'

/** What the decode reads and writes, buffer by buffer in the bindings' order (`DECODE_BINDING`):
 *  the list of visible clusters and the cluster records the cut holds, the roots' worlds, the
 *  placements' records and results, the decoded clusters, and the work buffer; and the dispatch
 *  arguments the plan writes (`args`, `DECODE_ARGS_BYTES`). */
export type DecodeInputs = {
  visible: GPUBuffer
  info: GPUBuffer
  rootWorlds: GPUBuffer
  placements: GPUBuffer
  outputs: GPUBuffer
  pages: GPUBuffer
  work: GPUBuffer
  args: GPUBuffer
}

/** The decode's bindings' kinds, in their order: the writable ones the decoded clusters and the work
 *  buffer. */
const KINDS = [
  'read-only-storage',
  'read-only-storage',
  'read-only-storage',
  'read-only-storage',
  'read-only-storage',
  'storage',
  'storage',
] as const satisfies readonly GPUBufferBindingType[]
/** The plan's: the list read, the work buffer and the arguments written. */
const PLAN_KINDS = [
  'read-only-storage',
  'storage',
  'storage',
] as const satisfies readonly GPUBufferBindingType[]

/** The decode's stages, per pass, compiled off the thread. */
function createDecodeStages(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  planLayout: GPUBindGroupLayout,
) {
  const constants = groupWidthConstants(groupWidth(device.limits))
  const planModule = device.createShaderModule({
    label: 'Trillion3D visible cluster plan',
    code: decodePlanSource(),
  })
  const decodeModule = device.createShaderModule({
    label: 'Trillion3D visible cluster decode',
    code: decodeSource(),
  })
  const planPipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [planLayout] })
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] })
  const stage = (
    modules: GPUShaderModule,
    pipelines: GPUPipelineLayout,
    entry: string,
    pass: RasterPass,
  ) => preparedComputeStage(device, pipelines, modules, entry, { PASS: pass, ...constants }).ask()
  const stages = RASTER_PASSES.map((pass) => ({
    plan: stage(planModule, planPipelineLayout, 'decodePlan', pass),
    decode: stage(decodeModule, pipelineLayout, 'decode', pass),
    deformPlan: stage(planModule, planPipelineLayout, 'deformPlan', pass),
  }))
  return stages
}

/** The groups of the plan and of the decode, each made again when a buffer it names moved. */
function createDecodeGroups(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  planLayout: GPUBindGroupLayout,
) {
  const held = heldGroup(),
    heldPlan = heldGroup()
  const group = (inputs: DecodeInputs) => {
    const { next } = held.identity
    next[0] = inputs.visible
    next[1] = inputs.info
    next[2] = inputs.rootWorlds
    next[3] = inputs.placements
    next[4] = inputs.outputs
    next[5] = inputs.pages
    next[6] = inputs.work
    next.length = KINDS.length
    if (held.identity.moved())
      held.group = device.createBindGroup({
        layout,
        entries: bufferEntries([
          inputs.visible,
          inputs.info,
          inputs.rootWorlds,
          inputs.placements,
          inputs.outputs,
          inputs.pages,
          inputs.work,
        ]),
      })
    return held.group!
  }
  const planGroup = (inputs: DecodeInputs) => {
    const { next } = heldPlan.identity
    next[0] = inputs.visible
    next[1] = inputs.work
    next[2] = inputs.args
    next.length = PLAN_KINDS.length
    if (heldPlan.identity.moved())
      heldPlan.group = device.createBindGroup({
        layout: planLayout,
        entries: bufferEntries([inputs.visible, inputs.work, inputs.args]),
      })
    return heldPlan.group!
  }
  return { group, planGroup }
}

/**
 * The decode of the visible clusters (`decodeWgsl.ts`): its stages — the plan, the decode of each
 * pass, the deformation's plan — compiled once a device, their groups made again when a buffer they
 * name moved. `encode` puts a pass's decode in a compute pass; the clusters it decodes are then in
 * `inputs.pages` from the index they hold in the list of visible clusters, and the clusters whose
 * vertices a deformation moves are listed in the work buffer (`DEFORM`). The plan's group and the
 * decode's are set in turn at index 0: the decode's dispatch reads its arguments from a buffer
 * only the plan's group binds.
 */
export function createGpuDecode(device: GPUDevice) {
  const layout = device.createBindGroupLayout({ entries: computeBufferEntries(KINDS) })
  const planLayout = device.createBindGroupLayout({ entries: computeBufferEntries(PLAN_KINDS) })
  const stages = createDecodeStages(device, layout, planLayout)
  const { group, planGroup } = createDecodeGroups(device, layout, planLayout)
  return {
    /** Whether every stage is compiled. */
    get ready() {
      return stages.every((s) => s.plan.ready && s.decode.ready && s.deformPlan.ready)
    },
    /** The stages of `pass`'s decode, for `chainReady`. */
    chain: (pass: RasterPass) => {
      const s = stages[pass]!
      return [s.plan, s.decode, s.deformPlan]
    },
    /** Settles once every stage is compiled; rejects when the device refuses one. */
    prepare: () =>
      Promise.all(stages.flatMap((s) => [s.plan, s.decode, s.deformPlan].map((p) => p.prepare()))),
    /** The plan and the decode of `pass` over `inputs`, then the plan of its deformation, in `compute`. */
    encode(compute: GPUComputePassEncoder, pass: RasterPass, inputs: DecodeInputs) {
      const s = stages[pass]!
      const plan = s.plan.get(),
        decode = s.decode.get(),
        deformPlan = s.deformPlan.get()
      if (!plan || !decode || !deformPlan) return
      compute.setBindGroup(0, planGroup(inputs))
      compute.setPipeline(plan)
      compute.dispatchWorkgroups(1)
      compute.setBindGroup(0, group(inputs))
      compute.setPipeline(decode)
      compute.dispatchWorkgroupsIndirect(inputs.args, decodeArgsAt(pass))
      compute.setBindGroup(0, planGroup(inputs))
      compute.setPipeline(deformPlan)
      compute.dispatchWorkgroups(1)
    },
  }
}
export type GpuDecode = ReturnType<typeof createGpuDecode>
