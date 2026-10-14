/**
 * Cache invalidation pass (step 7): the GPU half of the invalidation processing of the CPU's change
 * boxes. The CPU half — their per-light filtering — is `vsmInvalidationPhaseFromShadowBoxes`
 * (`invalidationPhase.ts`), its packing `packPhase` (`invalidationPack.ts`), its recording
 * `encodeVsmInvalidations` (`invalidationEncode.ts`). The
 * rows' moves never reach the CPU: their changes are staled on the GPU (`castInvalidation.ts`).
 *
 * Frame start, before `encodeVsmPageCarry` (and before `planVirtualShadowFrame`,
 * whose ids replace the previous frame's the payloads name):
 * ```ts
 * const boxes = vsmInvalidationPhaseFromShadowBoxes(cache, shadowChanges);  // engine moves
 * encodeVsmInvalidations(encoder, res, { device, mapSlotCount: cache.prevFrame?.mapSlotCount ?? 0 },
 *   [boxes]);
 * ```
 * Each phase is one load-balanced instance-page invalidation dispatch reading the previous frame's
 * VSM state (`res.prev`) and atomically OR-ing STALE_STATIC_MARK / STALE_DYNAMIC_MARK into
 * `res.prev.pageRequests`, which the page address update folds into the page metadata.
 *
 * Light moves / cache key changes are not here: the cache entry is invalidated on the CPU
 * (`VsmLightCache.updateCommon`), so the map is set up uncached
 * (VSM_MAP_UNCACHED) and its next map drops VSM_NEXT_KEEPS_PAGES; the collector skips such entries.
 */
import { vsmComputePipe, type VsmComputePipe } from './passKit.ts'
import { computeBufferEntry } from '../gpu/core/computeBindings.ts'
import { vsmBufferGroup, vsmEnsureBuffer, vsmRenderStorage } from './renderPass.ts'
import {
  VSM_INVALIDATION_PARAMS_BYTES,
  VSM_INVALIDATION_SPECS,
  vsmInvalidationWgsl,
} from './invalidationWgsl.ts'
import type { VsmInvalidationBatch } from './cacheManager.ts'
import {
  vsmBindGroupEntries,
  vsmBindGroupLayoutEntries,
  type VsmPerFrameSet,
  vsmFrameSetHeld,
  type VsmResources,
  vsmPerFrameSet,
} from './resources.ts'
import { ceilDiv } from '../../../math/src/scalar/integers.ts'
import type { VsmLayout } from './layout.ts'
import { dispatchRows, WORKGROUP_THREADS } from '../gpu/dispatch/grid.ts'
import { VSM_PASS_PREFIX } from '../stage/passLabels.ts'
import { releaseCastInvalidation, type VsmCastState } from './castInvalidation.ts'

/** One invalidation call: the collector's batch and the boxes its instances name — box `b` at
 *  `BOX_WORDS · b`, each drawn as one instance of identity rotation (`packBox`). */
export interface VsmInvalidationPhase {
  batch: VsmInvalidationBatch
  boxes: Float64Array
}

/** The invalidation's pass, and its pipe. */
const INVALIDATION_LABEL = `${VSM_PASS_PREFIX}invalidateInstancePages`

/** The invalidation's pipe for `layout` (`vsmComputePipe`): made once a device and source. */
export function vsmInvalidationPipe(device: GPUDevice, layout: VsmLayout) {
  const C = GPUShaderStage.COMPUTE
  return vsmComputePipe(device, INVALIDATION_LABEL, vsmInvalidationWgsl(layout), 'vsmStaleBoxes', [
    vsmBindGroupLayoutEntries(VSM_INVALIDATION_SPECS, layout, C),
    [
      computeBufferEntry(0, 'uniform', C),
      ...[1, 2].map((binding) => computeBufferEntry(binding, 'read-only-storage', C)),
    ],
  ])
}

interface Pipe {
  pipe: VsmComputePipe
  device: GPUDevice
  /** Group 0 over the tables of a frame set (`res.current`, the two in turn), made once a set. */
  tables: VsmPerFrameSet<GPUBindGroup>
}
/** What the invalidation of a set holds (`VsmResources.invalidation`): the pipe it was given, its
 *  WGSL built and looked up once, not every frame, and the upload buffers of its phase slots. */
export interface VsmInvalidationState {
  pipe?: Pipe
  slots: Slot[]
  /** The stale of the rows' shadow changes (`castInvalidation.ts`). */
  casts?: VsmCastState
}

/** What the invalidations of `res` hold, made at their first use. */
export const invalidationOf = (res: VsmResources) => (res.invalidation ??= { slots: [] })

function pipe(device: GPUDevice, res: VsmResources): Pipe {
  return (invalidationOf(res).pipe ??= {
    pipe: vsmInvalidationPipe(device, res.layout),
    device,
    tables: vsmFrameSetHeld(),
  })
}

/** Group 0 of `p` over the tables of `res.current` (`vsmPerFrameSet`). */
const tablesGroup = (res: VsmResources, p: Pipe) =>
  p.device.createBindGroup({
    layout: p.pipe.groups[0],
    entries: vsmBindGroupEntries(res, VSM_INVALIDATION_SPECS),
  })

/** Upload buffers of one phase slot (distinct per phase: every write lands before the submit). */
interface Slot {
  device: GPUDevice
  params: GPUBuffer
  buffers: Partial<Record<'instances' | 'items', GPUBuffer>>
  /** Group 1 over the slot's buffers (its pipe is the set's, `VsmInvalidationState`): made again
   *  when a list grew (`vsmEnsureBuffer`). */
  group?: GPUBindGroup
}

/** Frees the upload buffers of `res`'s invalidation phases, with the set (`destroyEngineVsm`). */
export function releaseVsmInvalidation(res: VsmResources) {
  for (const slot of res.invalidation?.slots ?? []) {
    slot.params.destroy()
    for (const buffer of Object.values(slot.buffers)) buffer.destroy()
  }
  if (res.invalidation) releaseCastInvalidation(res.invalidation)
  res.invalidation = undefined
}

export function slotOf(device: GPUDevice, res: VsmResources, k: number) {
  const { slots } = invalidationOf(res)
  while (slots.length <= k)
    slots.push({
      device,
      buffers: {},
      params: device.createBuffer({
        label: `vsm.invalidation.params${slots.length}`,
        size: VSM_INVALIDATION_PARAMS_BYTES,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      }),
    })
  return slots[k]
}

/** The params' words: the item count, the threads; the last two pad the struct, 0. */
const paramsImage = new Uint32Array(4)

/** Uploads a phase's packed boxes and `itemCount` items (`packPhase`) into `slot` and records its
 *  dispatch of `threads` threads. */
export function dispatchPhase(
  encoder: GPUCommandEncoder,
  res: VsmResources,
  device: GPUDevice,
  slot: Slot,
  phase: {
    itemCount: number
    threads: number
    instanceBytes: number
    items: Uint32Array
    image: Uint32Array
  },
) {
  const { itemCount, threads, instanceBytes, items, image } = phase
  const held = slot.buffers,
    [was0, was1] = [held.instances, held.items]
  const instanceBuffer = vsmEnsureBuffer(
    slot,
    'vsm.invalidation',
    'instances',
    instanceBytes,
    vsmRenderStorage(),
    16,
  )
  const itemBuffer = vsmEnsureBuffer(
    slot,
    'vsm.invalidation',
    'items',
    itemCount * 16,
    vsmRenderStorage(),
    16,
  )
  if (instanceBuffer !== was0 || itemBuffer !== was1) slot.group = undefined
  device.queue.writeBuffer(instanceBuffer, 0, image, 0, instanceBytes / 4)
  device.queue.writeBuffer(itemBuffer, 0, items, 0, itemCount * 4)
  paramsImage[0] = itemCount
  paramsImage[1] = threads
  device.queue.writeBuffer(slot.params, 0, paramsImage)

  const p = pipe(device, res)
  const pass = encoder.beginComputePass({ label: INVALIDATION_LABEL })
  pass.setPipeline(p.pipe.pipeline)
  pass.setBindGroup(0, vsmPerFrameSet(p.tables, res, tablesGroup, p))
  pass.setBindGroup(
    1,
    (slot.group ??= vsmBufferGroup(device, p.pipe.groups[1], [
      slot.params,
      instanceBuffer,
      itemBuffer,
    ])),
  )
  dispatchRows(pass, ceilDiv(threads, WORKGROUP_THREADS))
  pass.end()
}
