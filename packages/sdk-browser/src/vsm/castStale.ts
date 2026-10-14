/**
 * THE SHADOW CHANGES' STALE OF A FRAME SET (`castInvalidation.ts`), and what it holds while the set
 * lives: its three kernels (`castInvalidationWgsl.ts`) — the CPU's boxes appended to the list, the
 * dispatch sized from the list's count, the stale over the previous frame's tables —, its buffers,
 * and its groups, each made again when a buffer it names moved.
 *
 * Cache invalidation (step 7): one stale reads every change against the previous frame's maps
 * before `encodeVsmPageCarry`, atomically OR-ing STALE_STATIC_MARK / STALE_DYNAMIC_MARK into
 * `res.prev.pageRequests`, which the page address update folds into the page metadata. Light moves
 * and cache key changes are not here: the cache entry is invalidated on the CPU
 * (`VsmLightCache.updateCommon`), so the map is set up uncached (VSM_MAP_UNCACHED) and its next map
 * drops VSM_NEXT_KEEPS_PAGES; the collector skips such entries.
 */
import { ceilDiv } from '../../../math/src/scalar/integers.ts'
import { COMPUTE, computeBufferEntry } from '../gpu/core/computeBindings.ts'
import { sizedBuffer } from '../gpu/core/sizedBuffer.ts'
import { dispatchRows, WORKGROUP_THREADS } from '../gpu/dispatch/grid.ts'
import { heldGroup, type HeldGroup } from '../placement/composeGroups.ts'
import { VSM_PASS_PREFIX } from '../stage/passLabels.ts'
import { CAST_RECORD_WORDS } from '../webgpu/shadow/castChanges.ts'
import type { VsmCastBoxes } from './castBoxes.ts'
import {
  CAST_APPEND_ENTRY,
  CAST_APPEND_WGSL,
  CAST_ARGS_ENTRY,
  CAST_ARGS_WGSL,
  CAST_INVALIDATION_ENTRY,
  castInvalidationWgsl,
  VSM_CAST_PARAMS_BYTES,
} from './castInvalidationWgsl.ts'
import { VSM_INVALIDATION_SPECS } from './invalidationWgsl.ts'
import type { VsmLayout } from './layout.ts'
import { vsmComputePipe } from './passKit.ts'
import { vsmBufferGroup } from './passKit.ts'
import {
  vsmBindGroupEntries,
  vsmBindGroupLayoutEntries,
  vsmFrameSetHeld,
  vsmPerFrameSet,
  type VsmPerFrameSet,
  type VsmResources,
} from './resources.ts'

/** The pass that stales the shadow changes, its three kernels in it. */
const CAST_LABEL = `${VSM_PASS_PREFIX}invalidateCastPages`

/** The stale's kernels for `layout`, made once a device and source. */
export function vsmCastPipes(device: GPUDevice, layout: VsmLayout) {
  const [uniform, read, write] = (['uniform', 'read-only-storage', 'storage'] as const).map(
    (type) => (binding: number) => computeBufferEntry(binding, type),
  )
  return {
    append: vsmComputePipe(device, CAST_LABEL, CAST_APPEND_WGSL, CAST_APPEND_ENTRY, [
      [uniform(0), read(1), write(2)],
    ]),
    args: vsmComputePipe(device, CAST_LABEL, CAST_ARGS_WGSL, CAST_ARGS_ENTRY, [
      [uniform(0), read(1), write(2)],
    ]),
    stale: vsmComputePipe(
      device,
      CAST_LABEL,
      castInvalidationWgsl(layout),
      CAST_INVALIDATION_ENTRY,
      [
        vsmBindGroupLayoutEntries(VSM_INVALIDATION_SPECS, layout, COMPUTE),
        [uniform(0), read(1), read(2)],
      ],
    ),
  }
}

/** What the stale of a set holds (`VsmResources.invalidation`): its kernels, its group over the
 *  set's tables, its buffers — the parameters, the maps, the CPU's boxes, the indirect arguments —
 *  and its own groups over them and the list. */
export interface VsmCastState {
  device: GPUDevice
  pipes: ReturnType<typeof vsmCastPipes>
  tables: VsmPerFrameSet<GPUBindGroup>
  params: GPUBuffer
  maps?: GPUBuffer
  boxes?: GPUBuffer
  args?: GPUBuffer
  groups: { append: HeldGroup; sizing: HeldGroup; stale: HeldGroup }
}

/** The stale of `res`, made at its first use. */
function castState(device: GPUDevice, res: VsmResources) {
  return (res.invalidation ??= {
    device,
    pipes: vsmCastPipes(device, res.layout),
    tables: vsmFrameSetHeld(),
    params: device.createBuffer({
      label: `${CAST_LABEL}.params`,
      size: VSM_CAST_PARAMS_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    }),
    groups: { append: heldGroup(), sizing: heldGroup(), stale: heldGroup() },
  })
}

/** `held`'s group on `layout` over `buffers`, made again when one of them moved. */
function castGroup(
  state: VsmCastState,
  held: HeldGroup,
  layout: GPUBindGroupLayout,
  buffers: readonly GPUBuffer[],
) {
  const { next } = held.identity
  next.length = buffers.length
  for (let i = 0; i < buffers.length; i++) next[i] = buffers[i]
  if (held.identity.moved()) held.group = vsmBufferGroup(state.device, layout, buffers)
  return held.group!
}

/** Group 0 of the stale over the tables of `res.current`. */
const tablesGroup = (res: VsmResources, state: VsmCastState) =>
  state.device.createBindGroup({
    layout: state.pipes.stale.groups[0],
    entries: vsmBindGroupEntries(res, VSM_INVALIDATION_SPECS),
  })

/** The parameters' words: the maps' count, the CPU's boxes' count, then padding. */
const paramsImage = new Uint32Array(VSM_CAST_PARAMS_BYTES / 4)

/**
 * Records the stale of `res`'s previous frame's `maps` (`vsmCastMaps`) into `encoder`, its buffers
 * written: the CPU's `boxes` appended to the `list` first, room made for them, then the arguments'
 * kernel, then the stale over the dispatch it sized.
 */
export function encodeCastStale(
  encoder: GPUCommandEncoder,
  res: VsmResources,
  device: GPUDevice,
  frame: { maps: Uint32Array; boxes: VsmCastBoxes | null; list: GPUBuffer },
) {
  const state = castState(device, res),
    { pipes, groups, params } = state,
    { maps, boxes, list } = frame,
    boxCount = boxes?.count ?? 0
  const storage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  const mapBuffer = (state.maps = sizedBuffer(
    device,
    state.maps,
    maps.byteLength,
    storage,
    `${CAST_LABEL}.maps`,
  ))
  // `vsmCastMaps`'s words, a view of its own buffer.
  device.queue.writeBuffer(mapBuffer, 0, maps as Uint32Array<ArrayBuffer>)
  paramsImage[0] = maps.length
  paramsImage[1] = boxCount
  device.queue.writeBuffer(params, 0, paramsImage)
  const indirect = GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT
  const args = (state.args = sizedBuffer(device, state.args, 16, indirect, `${CAST_LABEL}.args`))
  const pass = encoder.beginComputePass({ label: CAST_LABEL })
  if (boxes && boxCount) {
    const words = boxCount * CAST_RECORD_WORDS
    const boxBuffer = (state.boxes = sizedBuffer(
      device,
      state.boxes,
      words * 4,
      storage,
      `${CAST_LABEL}.boxes`,
    ))
    device.queue.writeBuffer(boxBuffer, 0, boxes.words, 0, words)
    pass.setPipeline(pipes.append.pipeline)
    pass.setBindGroup(
      0,
      castGroup(state, groups.append, pipes.append.groups[0], [params, boxBuffer, list]),
    )
    dispatchRows(pass, ceilDiv(boxCount, WORKGROUP_THREADS))
  }
  pass.setPipeline(pipes.args.pipeline)
  pass.setBindGroup(0, castGroup(state, groups.sizing, pipes.args.groups[0], [params, list, args]))
  pass.dispatchWorkgroups(1)
  pass.setPipeline(pipes.stale.pipeline)
  pass.setBindGroup(0, vsmPerFrameSet(state.tables, res, tablesGroup, state))
  pass.setBindGroup(
    1,
    castGroup(state, groups.stale, pipes.stale.groups[1], [params, mapBuffer, list]),
  )
  pass.dispatchWorkgroupsIndirect(args, 0)
  pass.end()
}

/** Frees what the stale of `res` holds, with the set (`destroyEngineVsm`). */
export function releaseVsmInvalidation(res: VsmResources) {
  const state = res.invalidation
  for (const buffer of [state?.params, state?.maps, state?.boxes, state?.args]) buffer?.destroy()
  res.invalidation = undefined
}
