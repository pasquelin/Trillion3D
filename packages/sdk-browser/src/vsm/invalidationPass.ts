/**
 * Cache invalidation pass (step 7): the GPU half of the invalidation processing. The CPU half —
 * the per-light filtering of the engine's moved boxes — is `vsmInvalidationPhaseFromShadowBoxes`.
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
import { vsmBufferEntry, vsmComputePipe, type VsmComputePipe } from './passKit.ts'
import { vsmBufferGroup, vsmEnsureBuffer } from './renderPass.ts'
import {
  type VsmCacheManager,
  type VsmInstanceInvalidation,
  type VsmInvalidationBatch,
  type VsmLightCache,
} from './cacheManager.ts'
import {
  VSM_INVALIDATION_GROUP_SIZE,
  VSM_INVALIDATION_INSTANCE_BYTES,
  VSM_INVALIDATION_PARAMS_BYTES,
  VSM_INVALIDATION_SPECS,
  VSM_BOX_MOVING,
  VSM_BOX_CASTS,
  vsmInvalidationWgsl,
} from './invalidationWgsl.ts'
import {
  vsmBindGroupEntries,
  vsmBindGroupLayoutEntries,
  type VsmFrameBuffers,
  type VsmResources,
  vsmPerFrameSet,
} from './resources.ts'
import { ceilDiv } from '../../../math/src/scalar/integers.ts'
import type { VsmLayout } from './layout.ts'
import { dispatchGrid } from '../gpu/dispatch/grid.ts'

/** Words of a phase's box (`VsmInvalidationPhase.boxes`): its world centre, its half extent, and
 *  1 when it is cached as dynamic, else 0. */
const BOX_WORDS = 7

/** One invalidation call: the collector's batch and the boxes its instances name — box `b` at
 *  `BOX_WORDS · b`, each drawn as one instance of identity rotation (`packBox`). */
export interface VsmInvalidationPhase {
  batch: VsmInvalidationBatch
  boxes: Float64Array
}

/** The previous frame the invalidation reads (its uniforms and shadow map slot count). */
interface VsmInvalidationFrame {
  device: GPUDevice
  mapSlotCount: number
}

/** The engine's change list (`sdk-core/src/scene/light-shadow/changes.ts`, `createShadowChanges`). */
interface VsmShadowBoxSource {
  readonly count: number
  read(box: number): {
    min: ArrayLike<number>
    max: ArrayLike<number>
    moving: boolean
  }
}

/** A box that bounds nothing finite reaches every page: as large an extent as f32 clip math keeps. */
const UNBOUNDED_EXTENT = 1e15
/** The last box `writeBox` wrote, centre then half extent, as the lights' range test reads it. */
const lastBox = new Float64Array(6)

/** Writes the box `[min, max]` at `at` of `boxes` (`BOX_WORDS`) and into `lastBox`: its centre and
 *  half extent, the unbounded box when they are not finite or the box is inverted; false then. */
function writeBox(
  boxes: Float64Array,
  at: number,
  min: ArrayLike<number>,
  max: ArrayLike<number>,
  moving: boolean,
) {
  let finite = true
  for (let a = 0; a < 3; a++) {
    lastBox[a] = (min[a] + max[a]) * 0.5
    lastBox[3 + a] = (max[a] - min[a]) * 0.5
    finite &&= Number.isFinite(lastBox[a]) && Number.isFinite(lastBox[3 + a]) && lastBox[3 + a] >= 0
  }
  if (!finite) {
    lastBox.fill(0, 0, 3)
    lastBox.fill(UNBOUNDED_EXTENT, 3, 6)
  }
  boxes.set(lastBox, at)
  boxes[at + 6] = moving ? 1 : 0
  return finite
}

/**
 * The engine's moved world boxes (`plan.worldChanged` / `residencyChanged` / released
 * representation changes: each mover's box before AND after its move) as one invalidation phase,
 * filtered per light like the collector's: no entry fully cached, uncached
 * or invalidated; dynamic casters skip receiver-cover maps; local lights cull by radius.
 * One instance per box (identity rotation, world AABB); `moving` (already moving, outside the
 * static layer) = cached as dynamic, else static. Read the boxes before the plan consumes them
 * (`changes.settled()`). Returns null when the invalidation processing would skip (no cache data).
 */
export function vsmInvalidationPhaseFromShadowBoxes(
  cache: VsmCacheManager,
  source: VsmShadowBoxSource,
): VsmInvalidationPhase | null {
  if (!cache.acceptsInvalidations() || source.count === 0) return null
  const boxes = new Float64Array(source.count * BOX_WORDS)
  const instances: VsmInstanceInvalidation[] = []
  const entries: VsmLightCache[] = []
  for (const e of cache.entries.values()) if (e.mayHoldCachedPages()) entries.push(e)
  for (let b = 0; b < source.count; b++) {
    const { min, max, moving } = source.read(b)
    const finite = writeBox(boxes, b * BOX_WORDS, min, max, moving),
      radius = Math.hypot(lastBox[3], lastBox[4], lastBox[5])
    for (const entry of entries) {
      if (moving && entry.useCover) continue
      if (finite && !entry.affectsBounds(lastBox, radius)) continue
      for (let i = 0; i < entry.mapCaches.length; i++)
        instances.push({
          firstInstance: b,
          instanceCount: 1,
          payload: entry.mapId + i,
        })
    }
  }
  if (instances.length === 0) return null
  return { batch: { instances }, boxes }
}

// ---- GPU ------------------------------------------------------------------------------------

/** The invalidation's pipe for `layout` (`vsmComputePipe`): made once a device and source. */
export function vsmInvalidationPipe(device: GPUDevice, layout: VsmLayout) {
  const C = GPUShaderStage.COMPUTE
  return vsmComputePipe(
    device,
    'vsm.invalidateInstancePages',
    vsmInvalidationWgsl(layout),
    'vsmStaleBoxes',
    [
      vsmBindGroupLayoutEntries(VSM_INVALIDATION_SPECS, layout, C),
      [
        vsmBufferEntry(0, C, 'uniform'),
        ...[1, 2].map((binding) => vsmBufferEntry(binding, C, 'read-only-storage')),
      ],
    ],
  )
}

interface Pipe {
  pipe: VsmComputePipe
  device: GPUDevice
  /** Group 0 over the tables of a frame set (`res.current`, the two in turn), made once a set. */
  tables: WeakMap<VsmFrameBuffers, GPUBindGroup>
}
/** The pipe each `res` was given: its WGSL is built and looked up once, not every frame. */
const RES_PIPES = new WeakMap<VsmResources, Pipe>()

function pipe(device: GPUDevice, res: VsmResources): Pipe {
  let p = RES_PIPES.get(res)
  if (!p) {
    p = { pipe: vsmInvalidationPipe(device, res.layout), device, tables: new WeakMap() }
    RES_PIPES.set(res, p)
  }
  return p
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
  /** Group 1 over the slot's buffers (its pipe is the set's, `RES_PIPES`): made again when a list
   *  grew (`vsmEnsureBuffer`). */
  group?: GPUBindGroup
}
const SLOTS = new WeakMap<VsmResources, Slot[]>()
const STORAGE = () => GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST

/** Frees the upload buffers of `res`'s invalidation phases, with the set (`destroyEngineVsm`). */
export function releaseVsmInvalidation(res: VsmResources) {
  for (const slot of SLOTS.get(res) ?? []) {
    slot.params.destroy()
    for (const buffer of Object.values(slot.buffers)) buffer.destroy()
  }
  SLOTS.delete(res)
}

function slotOf(device: GPUDevice, res: VsmResources, k: number) {
  let slots = SLOTS.get(res)
  if (!slots) SLOTS.set(res, (slots = []))
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

// The scratch of `encodeVsmInvalidations`, rewritten for each phase: its items, its boxes as the
// shader reads them.
let items = new Uint32Array(64)
let image = new ArrayBuffer(VSM_INVALIDATION_INSTANCE_BYTES * 16)
let imageF = new Float32Array(image),
  imageU = new Uint32Array(image)
/** The params' words; the fourth pads the struct, 0. */
const paramsImage = new Uint32Array(4)
const INSTANCE_WORDS = VSM_INVALIDATION_INSTANCE_BYTES / 4
// The ranges of one phase, by their first instance: the index in the range lists of the last range
// taken at that offset (a range of the same offset and another count is a range of its own).
const rangeIndex = new Map<number, number>()
const rangeOffset: number[] = []
const rangeCount: number[] = []
const rangeAt: number[] = []

/** Packs the items of `list` (their first box in the image, box count, map, prefix), each range of
 *  boxes they name placed in the image once (`range*`): the threads they take, and the boxes. */
function packItems(list: readonly VsmInstanceInvalidation[]) {
  rangeIndex.clear()
  rangeOffset.length = rangeCount.length = rangeAt.length = 0
  let boxCount = 0,
    prefix = 0
  // A range's maps come one after another (one item per map): the last range is reused unkeyed.
  let lastOffset = -1,
    lastCount = -1,
    lastAt = 0
  if (items.length < list.length * 4) items = new Uint32Array(list.length * 8)
  for (let i = 0; i < list.length; i++) {
    const inv = list[i]
    let at = lastAt
    if (inv.firstInstance !== lastOffset || inv.instanceCount !== lastCount) {
      const found = rangeIndex.get(inv.firstInstance)
      if (found !== undefined && rangeCount[found] === inv.instanceCount) {
        at = rangeAt[found]
      } else {
        at = boxCount
        rangeIndex.set(inv.firstInstance, rangeOffset.length)
        rangeOffset.push(inv.firstInstance)
        rangeCount.push(inv.instanceCount)
        rangeAt.push(at)
        boxCount += inv.instanceCount
      }
      lastOffset = inv.firstInstance
      lastCount = inv.instanceCount
      lastAt = at
    }
    items[i * 4 + 0] = at
    items[i * 4 + 1] = inv.instanceCount
    items[i * 4 + 2] = inv.payload
    items[i * 4 + 3] = prefix
    prefix += inv.instanceCount
  }
  return { threads: prefix, boxCount }
}

/** Packs box `b` of `boxes` as instance `slot` of the image (96 B, `VsmInvalidationInstance`): an
 *  identity rotation whose translation is the box's centre (high f32, then low), a centre of 0, its
 *  extent and its flags; every other word 0. */
function packBox(boxes: Float64Array, b: number, slot: number) {
  const o = slot * INSTANCE_WORDS,
    at = b * BOX_WORDS
  imageF.fill(0, o, o + INSTANCE_WORDS)
  for (let c = 0; c < 3; c++) {
    // Column c = basis vector c; w = the translation's high f32.
    const t = boxes[at + c],
      high = Math.fround(t)
    imageF[o + c * 5] = 1
    imageF[o + c * 4 + 3] = high
    imageF[o + 12 + c] = t - high
    imageF[o + 20 + c] = boxes[at + 3 + c]
  }
  imageU[o + 19] = VSM_BOX_CASTS | (boxes[at + 6] ? VSM_BOX_MOVING : 0)
}

/** Packs the ranges `packItems` placed, `boxCount` boxes of `boxes`, into the image; the bytes they
 *  take. Every word of an instance is written: the image is not cleared. */
function packBoxes(boxes: Float64Array, boxCount: number) {
  const bytes = Math.max(1, boxCount) * VSM_INVALIDATION_INSTANCE_BYTES
  if (image.byteLength < bytes) {
    image = new ArrayBuffer(2 * bytes)
    imageF = new Float32Array(image)
    imageU = new Uint32Array(image)
  }
  for (let r = 0; r < rangeAt.length; r++)
    for (let j = 0; j < rangeCount[r]; j++) packBox(boxes, rangeOffset[r] + j, rangeAt[r] + j)
  return bytes
}

/** Uploads a phase's packed boxes and `itemCount` items into `slot` and records its dispatch of
 *  `threads` threads. */
function dispatchPhase(
  encoder: GPUCommandEncoder,
  res: VsmResources,
  device: GPUDevice,
  slot: Slot,
  phase: { itemCount: number; threads: number; instanceBytes: number },
) {
  const { itemCount, threads, instanceBytes } = phase
  const held = slot.buffers,
    [was0, was1] = [held.instances, held.items]
  const instanceBuffer = vsmEnsureBuffer(
    slot,
    'vsm.invalidation',
    'instances',
    instanceBytes,
    STORAGE(),
    16,
  )
  const itemBuffer = vsmEnsureBuffer(
    slot,
    'vsm.invalidation',
    'items',
    itemCount * 16,
    STORAGE(),
    16,
  )
  if (instanceBuffer !== was0 || itemBuffer !== was1) slot.group = undefined
  const [groupsX, groupsY] = dispatchGrid(ceilDiv(threads, VSM_INVALIDATION_GROUP_SIZE))
  device.queue.writeBuffer(instanceBuffer, 0, imageU, 0, instanceBytes / 4)
  device.queue.writeBuffer(itemBuffer, 0, items, 0, itemCount * 4)
  paramsImage[0] = itemCount
  paramsImage[1] = threads
  paramsImage[2] = groupsX
  device.queue.writeBuffer(slot.params, 0, paramsImage)

  const p = pipe(device, res)
  const pass = encoder.beginComputePass({ label: 'vsm.invalidateInstancePages' })
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
  pass.dispatchWorkgroups(groupsX, groupsY)
  pass.end()
}

/**
 * Records the invalidation dispatches of `phases` (in order: before the scene update, after it,
 * then the engine's box phase). Nothing when the previous frame had no shadow map slots
 * or a phase has no instance. Must run before `swapFrames()` of this frame and before
 * `encodeVsmPageCarry`. Returns the number of (instance, VSM) pairs dispatched.
 */
export function encodeVsmInvalidations(
  encoder: GPUCommandEncoder,
  res: VsmResources,
  prevFrame: VsmInvalidationFrame,
  phases: readonly (VsmInvalidationPhase | null | undefined)[],
) {
  if (!(prevFrame.mapSlotCount > 0)) return 0
  let total = 0,
    k = 0
  for (const phase of phases) {
    if (!phase || phase.batch.instances.length === 0) continue
    const slot = slotOf(prevFrame.device, res, k++)
    const list = phase.batch.instances,
      { threads, boxCount } = packItems(list)
    if (threads === 0) continue
    const instanceBytes = packBoxes(phase.boxes, boxCount)
    dispatchPhase(encoder, res, prevFrame.device, slot, {
      itemCount: list.length,
      threads,
      instanceBytes,
    })
    total += threads
  }
  return total
}
