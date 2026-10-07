import { writeReprojection } from '../taa/view.ts'
import {
  createReflectionHistoryTargets,
  type ReflectionMoment,
  type ReflectionPrevious,
} from './historyTargets.ts'
import {
  REFLECTION_CHANGE_FRAMES,
  REFLECTION_RESOLVE_VIEW_BYTES,
  REFLECTION_STILL_FRAMES,
} from './resolveWgsl.ts'
import {
  historyConfidence,
  REFLECTION_LIGHTING_VERSIONS,
  REFLECTION_PLACEMENT_VERSIONS,
  type ReflectionHistoryFrame,
} from './historyFrame.ts'
import { sameElements, sameValues } from '../math/matrixElements.ts'
import { createWebgpuBindIdentity, type WebgpuBindIdentity } from '../webgpu/core/bindIdentity.ts'
import { reflectionOwnerLayout } from './layout.ts'

/** What a history keeps between its calls: its targets, the trace's group of the records it writes
 *  (`sampleWgsl.ts`), the resolve's view and the words written into it, the last frame's matrix,
 *  camera, epochs and lighting, and one group per history image it resolves from. */
type HistoryState = {
  device: GPUDevice
  targets: ReturnType<typeof createReflectionHistoryTargets>
  owners: GPUBindGroup
  uniform: GPUBuffer
  packed: Float32Array<ArrayBuffer>
  previous: Float64Array
  camera: Float64Array
  epoch: Float64Array
  lighting: Float64Array
  bindings: WeakMap<GPUTextureView, { identity: WebgpuBindIdentity; group?: GPUBindGroup }>
  frame: number
  written: boolean
  rank: number
  reuse: boolean
  disposed: boolean
  stableFrames: number
  /** Frames resolved since a source changed; none: Infinity. */
  sinceChange: number
  drawnWidth: number
  drawnHeight: number
  current?: ReflectionHistoryFrame
  matrix?: ArrayLike<number>
}

/** The still window (`REFLECTION_STILL_FRAMES`) is complete, and no stale share of a changed
 *  source remains. */
const complete = (h: HistoryState) =>
  h.stableFrames >= REFLECTION_STILL_FRAMES &&
  h.sinceChange >= REFLECTION_CHANGE_FRAMES + REFLECTION_STILL_FRAMES

/** A new history's resources and state; its targets are destroyed when its view cannot be made. */
function historyState(
  device: GPUDevice,
  width: number,
  height: number,
  kept: ReflectionPrevious,
): HistoryState {
  const targets = createReflectionHistoryTargets(device, width, height, kept)
  // The trace's group of the records it writes (`sampleWgsl.ts`).
  const owners = device.createBindGroup({
    layout: reflectionOwnerLayout(device),
    entries: [{ binding: 0, resource: targets.owners }],
  })
  let uniform: GPUBuffer
  try {
    uniform = device.createBuffer({
      label: 'Trillion3D reflection resolve view',
      size: REFLECTION_RESOLVE_VIEW_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
  } catch (error) {
    targets.dispose()
    throw error
  }
  return {
    device,
    targets,
    owners,
    uniform,
    packed: new Float32Array(REFLECTION_RESOLVE_VIEW_BYTES / 4),
    previous: new Float64Array(16),
    camera: new Float64Array(16),
    epoch: new Float64Array(REFLECTION_PLACEMENT_VERSIONS).fill(NaN),
    lighting: new Float64Array(REFLECTION_LIGHTING_VERSIONS).fill(NaN),
    bindings: new WeakMap(),
    frame: -1,
    written: false,
    rank: 0,
    reuse: false,
    disposed: false,
    stableFrames: 0,
    sinceChange: Infinity,
    drawnWidth: width,
    drawnHeight: height,
  }
}

/** Owns only the reflection mean, its metadata and the trace's records of its texels' pixels
 * (`sampleWgsl.ts`); placement data remains shared.
 * A repeated frame with unchanged sources reuses its resolved result, rather than
 * blending it twice against metadata that has already advanced. */
export function createReflectionHistory(
  device: GPUDevice,
  width: number,
  height: number,
  kept: ReflectionPrevious,
) {
  const h = historyState(device, width, height, kept)
  const { targets } = h
  return {
    bytes: targets.bytes,
    owners: h.owners,
    get image() {
      return targets.image
    },
    get rank() {
      return h.rank
    },
    get reuse() {
      return h.reuse
    },
    /** The still window (`REFLECTION_STILL_FRAMES`) is complete, and no stale share of a changed
     *  source remains; a new jitter still needs reprojection. */
    get settled() {
      return complete(h)
    },
    /** Source epochs cover reflected movers too, not just receiver identity. With live motion a
     *  moved source keeps the history, reprojected, clipped to the image's neighbourhood (#831);
     *  without, it keeps `REFLECTION_CHANGE_KEPT` for `REFLECTION_CHANGE_FRAMES`. A relit source
     *  (lights, materials) keeps it clipped while it changes, then `REFLECTION_CHANGE_KEPT` for
     *  `REFLECTION_CHANGE_FRAMES` from the first image after: no motion brings an old lighting to
     *  the new one, and a held image keeps nothing of it (#1342). Reset each image, a flickering
     *  brazier's or a circling lamp's scene drew every rough reflection from one image's samples:
     *  sparks. A new drawn extent resets it. */
    prepare(
      next: ReflectionHistoryFrame,
      projection: ArrayLike<number>,
      drawn: readonly number[] = [width, height],
    ) {
      prepareHistory(h, next, projection, drawn)
    },
    encode: (
      encoder: GPUCommandEncoder,
      scratch: GPUTextureView,
      pipeline: GPURenderPipeline,
      layout: GPUBindGroupLayout,
    ) => encodeHistory(h, encoder, scratch, pipeline, layout),
    dispose() {
      if (h.disposed) return
      h.disposed = true
      targets.dispose()
      h.uniform.destroy()
    },
  }
}
export type ReflectionHistory = ReturnType<typeof createReflectionHistory>

/** The history's `prepare` (`createReflectionHistory`): whether the frame reuses the last
 *  resolve, else what it keeps of the history, written into the resolve's view. */
function prepareHistory(
  h: HistoryState,
  next: ReflectionHistoryFrame,
  projection: ArrayLike<number>,
  drawn: readonly number[],
) {
  const resized = h.drawnWidth !== drawn[0] || h.drawnHeight !== drawn[1]
  const moved = !sameValues(h.epoch, next.epoch)
  const relit = !sameValues(h.lighting, next.lighting)
  const changed = resized || moved || relit
  h.drawnWidth = drawn[0]
  h.drawnHeight = drawn[1]
  const cameraChanged = !sameElements(h.camera, next.camera)
  h.reuse =
    !changed &&
    !cameraChanged &&
    h.written &&
    sameElements(h.previous, projection) &&
    (complete(h) || h.frame === next.frame)
  if (h.reuse) return
  if (changed || cameraChanged) h.stableFrames = 0
  // A change neither the motion nor the clip follows.
  const unfollowed = moved && next.motion === next.pages
  if (resized) {
    h.written = false
    h.rank = 0
    h.sinceChange = Infinity
  } else if (h.written) {
    h.rank = (h.rank + 1) >>> 0
    // A change the motion cannot follow keeps the history at the change weight (#33); a
    // relight, from the first image after it.
    if (unfollowed || relit) h.sinceChange = 0
  }
  h.current = next
  h.camera.set(next.camera)
  h.matrix = projection
  h.epoch.set(next.epoch)
  h.lighting.set(next.lighting)
  h.frame = next.frame
  // While its sources, their lighting or the camera move, the history is clipped to the
  // image's neighbourhood.
  writeResolveView(
    h,
    next,
    projection,
    drawn,
    relit && !unfollowed,
    moved || relit || cameraChanged,
  )
}

/** The resolve's view of a prepared frame: its reprojection, whether it reads a history, the
 *  history's confidence (`relitOnly`: a relight the motion follows), whether it reprojects, the
 *  trace's seed and whether the history is clipped. */
function writeResolveView(
  h: HistoryState,
  next: ReflectionHistoryFrame,
  projection: ArrayLike<number>,
  drawn: readonly number[],
  relitOnly: boolean,
  clipped: boolean,
) {
  const { packed, written } = h
  const reprojects = next.motion !== next.pages
  writeReprojection(packed, written ? h.previous : projection, projection, next.eye, drawn)
  packed[36] = written ? 1 : 0
  packed[37] = historyConfidence(relitOnly, h.sinceChange)
  packed[38] = reprojects ? 1 : 0
  // The low bits of the trace's seed, the rank's alone (`gpu.ts`): which pixel of each 2 × 2
  // block it traced; four successive ranks visit all four.
  packed[39] = h.rank & 3
  packed[40] = clipped ? 1 : 0
  h.device.queue.writeBuffer(h.uniform, 0, packed)
}

/** The history's `encode` (`createReflectionHistory`): resolves the prepared frame into the next
 *  history image, unless the frame reuses the last one. */
function encodeHistory(
  h: HistoryState,
  encoder: GPUCommandEncoder,
  scratch: GPUTextureView,
  pipeline: GPURenderPipeline,
  layout: GPUBindGroupLayout,
) {
  if (h.reuse) return h.targets.image
  const { current, matrix } = h
  if (!current || !matrix) throw new Error('REFLECTION_HISTORY_NOT_PREPARED')
  const image = h.targets.resolve(encoder, current.metadata, (history, output, moment) => {
    const group = resolveGroup(h, current, history, scratch, layout, moment)
    const pass = encoder.beginRenderPass({
      label: 'Trillion3D reflection history resolve',
      colorAttachments: [
        { view: output, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] },
        { view: moment.output, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] },
      ],
    })
    pass.setViewport(0, 0, h.drawnWidth, h.drawnHeight, 0, 1)
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, group)
    pass.draw(3)
    pass.end()
  })
  h.previous.set(matrix)
  h.written = true
  h.stableFrames++
  h.sinceChange++
  return image
}

/** The resolve's group reading `history`, kept under it while what it names stays the same. */
function resolveGroup(
  h: HistoryState,
  { metadata, pages, motion }: ReflectionHistoryFrame,
  history: GPUTextureView,
  scratch: GPUTextureView,
  layout: GPUBindGroupLayout,
  moment: ReflectionMoment,
) {
  const { targets } = h
  let bound = h.bindings.get(history)
  if (!bound) h.bindings.set(history, (bound = { identity: createWebgpuBindIdentity() }))
  const next = bound.identity.next
  next[0] = layout
  next[1] = scratch
  next[2] = metadata.depth
  next[3] = metadata.normal
  next[4] = metadata.ids
  next[5] = pages
  next[6] = motion
  next[7] = moment.held
  if (bound.identity.moved()) {
    const views = [
      scratch,
      history,
      metadata.depth.createView(),
      metadata.normal.createView(),
      metadata.ids.createView(),
      targets.previous.depth,
      targets.previous.normal,
      targets.previous.ids,
    ]
    bound.group = h.device.createBindGroup({
      layout,
      entries: [
        ...views.map((resource, binding) => ({ binding, resource })),
        { binding: 8, resource: { buffer: h.uniform } },
        { binding: 9, resource: { buffer: pages } },
        { binding: 10, resource: { buffer: motion } },
        { binding: 11, resource: moment.held },
        { binding: 12, resource: targets.owners },
      ],
    })
  }
  return bound.group!
}
