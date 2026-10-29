import type { VsmFramePlan } from '../../../lighting/shadows/vsm/frameSetup.ts'

/**
 * WHETHER THE VIRTUAL SHADOW MAPS HAVE SETTLED, and their contents' version, from their own state:
 * what a capture waits for (`shadowsUnsettled`) and what restarts a still temporal average
 * (`shadowEpoch`). The pages the raster drew are counted on the GPU
 * (`VSM_COUNT_CLEARED`) and read back a few frames late, each copy stamped with its frame.
 *
 * A frame is a cause when it can draw pages the image has not shown yet: an invalidation, a light
 * whose maps start uncached or were invalidated, the global resolution bias moved by the budget
 * feedback, a raster skipped. The maps are settled once a count read back from a frame at or after
 * the last cause says no page was drawn.
 *
 * The maps have arrived once a count is read back from a frame at or after the last cause other
 * than an invalidation (`arrivalFrame`): every light drawn uncached, the resolution bias and the
 * raster as the image asks them. A caster that moves invalidates its pages on every image it moves
 * on, so a scene that animates one never settles; it still arrives.
 */
export interface VsmSettle {
  /** Last frame that could draw pages not yet shown. */
  causeFrame: number
  /** Last such frame whose cause was not an invalidation (see `vsmArrived`). */
  arrivalFrame: number
  /** Frame of the latest count read back, and the pages it drew. */
  landedFrame: number
  landedRendered: number
  /** Pages drawn so far, every count read back summed: the maps' contents version. */
  renderedTotal: number
  /** The global resolution bias the last plan used (budget feedback). */
  lodBias: number
  /** Frame of each count copy in flight. */
  readonly stamps: Map<GPUBuffer, number>
  /** The frame of the last `finishVsmFrame`. */
  frame: number
}

export const createVsmSettle = (): VsmSettle => ({
  causeFrame: 0,
  arrivalFrame: 0,
  landedFrame: -1,
  landedRendered: 0,
  renderedTotal: 0,
  lodBias: Number.NaN,
  stamps: new Map(),
  frame: 0,
})

/**
 * Frame `frame`'s plan is done: notes a cause when it invalidated pages (`invalidations` threads),
 * starts or restarts a light uncached (`plan.uncachedDrawn`, read before the raster marked the
 * lights rendered), changes the resolution bias, or skipped its raster.
 */
export function noteVsmFrame(
  settle: VsmSettle,
  frame: number,
  plan: VsmFramePlan,
  invalidations: number,
  lodBias: number,
  rendered: boolean,
) {
  settle.frame = frame
  const arrival = !rendered || lodBias !== settle.lodBias || plan.uncachedDrawn
  settle.lodBias = lodBias
  if (arrival) settle.arrivalFrame = frame
  if (arrival || invalidations > 0) settle.causeFrame = frame
  if (plan.overflow || plan.projectionCount === 0) noteNoMapFrame(settle, frame)
}

/** Frame `frame` shadows no light and plans nothing (`shadowQuality` 0 with the set kept): a
 *  frame with no map, whose answer the plan's `noteVsmFrame` gives for a plan with none. */
export function noteVsmIdleFrame(settle: VsmSettle, frame: number) {
  settle.frame = frame
  noteNoMapFrame(settle, frame)
}

/** A frame with no map draws nothing and reads no count: it is its own answer. A copy of an older
 *  frame still in flight lands with an older stamp, which `landVsmStats` ignores. */
function noteNoMapFrame(settle: VsmSettle, frame: number) {
  settle.landedFrame = frame
  settle.landedRendered = 0
}

/** The count copy `staging` of frame `frame` was recorded. */
export const stampVsmStats = (settle: VsmSettle, staging: GPUBuffer, frame: number) =>
  settle.stamps.set(staging, frame)

/** The count copy `staging` landed: `rendered` pages were drawn in its frame. */
export function landVsmStats(settle: VsmSettle, staging: GPUBuffer, rendered: number) {
  const frame = settle.stamps.get(staging) ?? -1
  settle.stamps.delete(staging)
  settle.renderedTotal += rendered
  if (frame < settle.landedFrame) return
  settle.landedFrame = frame
  settle.landedRendered = rendered
}

/** Frames a device without the counters (`countersOn` false) waits after a cause. */
const BLIND_FRAMES = 4

/** True while the maps can still change what the image shows (see `VsmSettle`). */
export function vsmUnsettled(settle: VsmSettle, countersOn: boolean) {
  if (!countersOn) return settle.frame - settle.causeFrame < BLIND_FRAMES
  return settle.landedFrame < settle.causeFrame || settle.landedRendered > 0
}

/** True once the maps have arrived (see `VsmSettle`): drawn as the image asks them, whatever
 *  casters that move still redraw. */
export function vsmArrived(settle: VsmSettle, countersOn: boolean) {
  if (!countersOn) return settle.frame - settle.arrivalFrame >= BLIND_FRAMES
  return settle.landedFrame >= settle.arrivalFrame
}
