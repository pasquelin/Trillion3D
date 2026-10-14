/**
 * THE SHADOW CHANGES' STALE OF A FRAME SET (`castInvalidation.ts`), and what it holds while the set
 * lives: its two kernels (`castInvalidationWgsl.ts`) — the dispatch sized from the list's count and
 * the CPU's boxes', the stale over the previous frame's tables —, its buffers, and its groups, their
 * entries read live (`liveEntries.ts`), each made again when a buffer it names moved
 * (`composeGroup`).
 *
 * Cache invalidation (step 7): one stale reads every change against the previous frame's maps
 * before `encodeVsmPageCarry`, atomically OR-ing STALE_STATIC_MARK / STALE_DYNAMIC_MARK into
 * `res.prev.pageRequests`, which the page address update folds into the page metadata. Light moves
 * and cache key changes are not here: the cache entry is invalidated on the CPU
 * (`VsmLightCache.updateCommon`), so the map is set up uncached (VSM_MAP_UNCACHED) and its next map
 * drops VSM_NEXT_KEEPS_PAGES; the maps sent skip such entries (`vsmCastMaps`, through
 * `mayHoldCachedPages`).
 */
import { COMPUTE, computeBufferEntry } from '../gpu/core/computeBindings.ts'
import { sizedBuffer } from '../gpu/core/sizedBuffer.ts'
import { composeGroup, heldGroup, type HeldGroup } from '../webgpu/core/bindIdentity.ts'
import { bufferEntry } from '../webgpu/core/liveEntries.ts'
import { VSM_PASS_PREFIX } from '../stage/passLabels.ts'
import { CAST_BOX_WORDS, type VsmCastBoxes } from './castBoxes.ts'
import {
  CAST_ARGS_ENTRY,
  CAST_ARGS_WGSL,
  CAST_INVALIDATION_ENTRY,
  castInvalidationWgsl,
  VSM_CAST_PARAMS_BYTES,
} from './castInvalidationWgsl.ts'
import { VSM_INVALIDATION_SPECS } from './invalidationWgsl.ts'
import type { VsmLayout } from './layout.ts'
import { vsmComputePipe } from './passKit.ts'
import {
  vsmBindGroupEntries,
  vsmBindGroupLayoutEntries,
  vsmFrameSetHeld,
  vsmPerFrameSet,
  type VsmPerFrameSet,
  type VsmResources,
} from './resources.ts'

/** The pass that stales the shadow changes, its two kernels in it. */
const CAST_LABEL = `${VSM_PASS_PREFIX}invalidateCastPages`

/** The stale's kernels for `layout`, made once a device and source. */
export function vsmCastPipes(device: GPUDevice, layout: VsmLayout) {
  const [uniform, read, write] = (['uniform', 'read-only-storage', 'storage'] as const).map(
    (type) => (binding: number) => computeBufferEntry(binding, type),
  )
  return {
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
        [uniform(0), read(1), read(2), read(3)],
      ],
    ),
  }
}

/** What the stale of a set holds (`VsmResources.invalidation`): its kernels, its group over the
 *  set's tables, its buffers — the parameters, the maps, the CPU's boxes, the indirect arguments —,
 *  the list the frame hands it, and its own groups over them. */
export interface VsmCastState {
  device: GPUDevice
  pipes: ReturnType<typeof vsmCastPipes>
  tables: VsmPerFrameSet<GPUBindGroup>
  params: GPUBuffer
  maps?: GPUBuffer
  boxes?: GPUBuffer
  args?: GPUBuffer
  list?: GPUBuffer
  groups: { sizing: HeldGroup; stale: HeldGroup }
}

/** The stale of `res`, made at its first use: its groups' entries made once, each reading its
 *  buffer from the state when the group is composed. */
function castState(device: GPUDevice, res: VsmResources) {
  if (res.invalidation) return res.invalidation
  const state: VsmCastState = (res.invalidation = {
    device,
    pipes: vsmCastPipes(device, res.layout),
    tables: vsmFrameSetHeld(),
    params: device.createBuffer({
      label: `${CAST_LABEL}.params`,
      size: VSM_CAST_PARAMS_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    }),
    groups: { sizing: heldGroup(), stale: heldGroup() },
  })
  const params = bufferEntry(0, () => state.params)
  state.groups.sizing.identity.entries[0] = [
    params,
    bufferEntry(1, () => state.list),
    bufferEntry(2, () => state.args),
  ]
  state.groups.stale.identity.entries[0] = [
    params,
    bufferEntry(1, () => state.maps),
    bufferEntry(2, () => state.list),
    bufferEntry(3, () => state.boxes),
  ]
  return state
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
 * written: the arguments' kernel over the `list`'s count and the CPU's `boxes`', then the stale over
 * the dispatch it sized, the list's records then the boxes'.
 */
export function encodeCastStale(
  encoder: GPUCommandEncoder,
  res: VsmResources,
  device: GPUDevice,
  maps: Uint32Array,
  boxes: VsmCastBoxes | null,
  list: GPUBuffer,
) {
  const state = castState(device, res),
    { pipes, groups, params } = state,
    boxCount = boxes?.count ?? 0
  const storage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  state.maps = sizedBuffer(device, state.maps, maps.byteLength, storage, `${CAST_LABEL}.maps`)
  // `vsmCastMaps`'s words, a view of its own buffer.
  device.queue.writeBuffer(state.maps, 0, maps as Uint32Array<ArrayBuffer>)
  // A record at least: the stale's group binds the boxes on a frame that has none.
  const words = boxCount * CAST_BOX_WORDS
  state.boxes = sizedBuffer(
    device,
    state.boxes,
    Math.max(words, CAST_BOX_WORDS) * 4,
    storage,
    `${CAST_LABEL}.boxes`,
  )
  if (boxCount) device.queue.writeBuffer(state.boxes, 0, boxes!.words, 0, words)
  paramsImage[0] = maps.length
  paramsImage[1] = boxCount
  device.queue.writeBuffer(params, 0, paramsImage)
  const indirect = GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT
  state.args = sizedBuffer(device, state.args, 16, indirect, `${CAST_LABEL}.args`)
  state.list = list
  composeGroup(device, groups.sizing, pipes.args.pipeline)
  composeGroup(device, groups.stale, pipes.stale.pipeline, 1)
  const pass = encoder.beginComputePass({ label: CAST_LABEL })
  pass.setPipeline(pipes.args.pipeline)
  pass.setBindGroup(0, groups.sizing.group!)
  pass.dispatchWorkgroups(1)
  pass.setPipeline(pipes.stale.pipeline)
  pass.setBindGroup(0, vsmPerFrameSet(state.tables, res, tablesGroup, state))
  pass.setBindGroup(1, groups.stale.group!)
  pass.dispatchWorkgroupsIndirect(state.args, 0)
  pass.end()
}

/** Frees what the stale of `res` holds, with the set (`destroyEngineVsm`). */
export function releaseVsmInvalidation(res: VsmResources) {
  const state = res.invalidation
  for (const buffer of [state?.params, state?.maps, state?.boxes, state?.args]) buffer?.destroy()
  res.invalidation = undefined
}
