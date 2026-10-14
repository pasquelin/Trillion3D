/**
 * What the shadow changes' stale holds for a frame set, and its pass (`castInvalidation.ts`): its
 * kernels (`castPipes.ts`), its group over the set's tables, its buffers, and its two other groups
 * with the buffers they were made over, made again when one of them moved.
 */
import { vsmBufferGroup, vsmEnsureBuffer } from './renderPass.ts'
import {
  vsmBindGroupEntries,
  vsmFrameSetHeld,
  vsmPerFrameSet,
  type VsmPerFrameSet,
  type VsmResources,
} from './resources.ts'
import { VSM_INVALIDATION_PARAMS_BYTES, VSM_INVALIDATION_SPECS } from './invalidationWgsl.ts'
import { CAST_LABEL, vsmCastPipes } from './castPipes.ts'

/** The buffers a stale's own groups name: the rows' list, the maps, the CPU's boxes. */
interface CastBuffers {
  list: GPUBuffer
  maps: GPUBuffer
  boxes: GPUBuffer
}

/** What the stale holds for a set (`VsmInvalidationState.casts`): its kernels, its group over the
 *  set's tables, its buffers — the parameters, the maps, the CPU's boxes, the indirect arguments,
 *  an empty list —, and its two other groups with the buffers they were made over. */
export interface VsmCastState {
  device: GPUDevice
  pipes: ReturnType<typeof vsmCastPipes>
  tables: VsmPerFrameSet<GPUBindGroup>
  params: GPUBuffer
  buffers: Partial<Record<'maps' | 'boxes' | 'args' | 'empty', GPUBuffer>>
  groups?: CastBuffers & { args: GPUBuffer; sizing: GPUBindGroup; stale: GPUBindGroup }
}

/** The stale of `res`, made at its first use. */
export function castState(device: GPUDevice, res: VsmResources, held: { casts?: VsmCastState }) {
  return (held.casts ??= {
    device,
    pipes: vsmCastPipes(device, res.layout),
    tables: vsmFrameSetHeld(),
    params: device.createBuffer({
      label: 'vsm.castInvalidation.params',
      size: VSM_INVALIDATION_PARAMS_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    }),
    buffers: {},
  })
}

/** The arguments' group and the stale's own over `on` and `args`: those held while each names the
 *  same buffers. */
function castGroups(state: VsmCastState, on: CastBuffers, args: GPUBuffer) {
  const held = state.groups
  if (
    held &&
    held.list === on.list &&
    held.maps === on.maps &&
    held.boxes === on.boxes &&
    held.args === args
  )
    return held
  const { device, pipes, params } = state
  return (state.groups = {
    list: on.list,
    maps: on.maps,
    boxes: on.boxes,
    args,
    sizing: vsmBufferGroup(device, pipes.args.groups[0], [params, on.list, args]),
    stale: vsmBufferGroup(device, pipes.stale.groups[1], [params, on.maps, on.list, on.boxes]),
  })
}

/** Group 0 of the stale over the tables of `res.current`. */
const tablesGroup = (res: VsmResources, state: VsmCastState) =>
  state.device.createBindGroup({
    layout: state.pipes.stale.groups[0],
    entries: vsmBindGroupEntries(res, VSM_INVALIDATION_SPECS),
  })

/** Records the stale's pass over `on`, its parameters written: the arguments' kernel, then the
 *  stale over the dispatch it sized. */
export function encodeCastStale(
  encoder: GPUCommandEncoder,
  res: VsmResources,
  state: VsmCastState,
  on: CastBuffers,
) {
  const indirect = GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT
  const args = vsmEnsureBuffer(state, 'vsm.castInvalidation', 'args', 16, indirect, 16)
  const groups = castGroups(state, on, args)
  const { stale, args: sizing } = state.pipes
  const pass = encoder.beginComputePass({ label: CAST_LABEL })
  pass.setPipeline(sizing.pipeline)
  pass.setBindGroup(0, groups.sizing)
  pass.dispatchWorkgroups(1)
  pass.setPipeline(stale.pipeline)
  pass.setBindGroup(0, vsmPerFrameSet(state.tables, res, tablesGroup, state))
  pass.setBindGroup(1, groups.stale)
  pass.dispatchWorkgroupsIndirect(args, 0)
  pass.end()
}

/** Frees the stale's buffers with the set (`releaseVsmInvalidation`). */
export function releaseCastInvalidation(held: { casts?: VsmCastState }) {
  held.casts?.params.destroy()
  for (const buffer of Object.values(held.casts?.buffers ?? {})) buffer?.destroy()
  held.casts = undefined
}
