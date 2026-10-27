// The offset the sun's clipmaps are centred on (`../viewOrigin.ts`), and the cast of the view's line of
// sight that gives it. The physics answers from its worker, a frame later: the view plans with the
// offset of its last answer and is replayed when an answer moves it.
import { cameraForward } from '../../../../camera/forward.ts'
import type { EngineCamera } from '../../../../camera/engineCamera.ts'
import type { WebgpuPagesRuntime } from '../../../../frame/backend/runtime.ts'
import { breakHeldFrame, viewGroup, type WebgpuView } from '../../../../frame/backend/state/view.ts'
import { rayHitDistance, type ViewOriginCast } from '../../../../physics/viewOriginCast.ts'
import type { ShadowValues } from '../../../../../../sdk-core/src/contracts/shadowOptions.ts'
import type { Object3D } from '../../../../../../sdk-core/src/world/object/object3d.ts'
import { sameRange } from '../../../../../../math/src/matrix/matrixElements.ts'
import { isZeroVector3 } from '../../../../../../math/src/vector/vector.ts'
import type { VsmFrameLight } from '../frameSetup.ts'
import { vsmShadowed } from '../seenLights.ts'

/** What a view knows of its cast. */
interface OriginCast {
  /** The view's forward by the distance of the last answer: the offset its origin takes; zero. */
  readonly offset: Float64Array
  /** The ray of the cast last posted: where from, which way, how far, and through which body. */
  readonly eye: Float64Array
  readonly forward: Float64Array
  reach: number
  ignore: Object3D | undefined
  /** The world's revision (`ViewOriginCast.revision`) that cast was posted at, once the frame's
   *  commands were flushed: its answer, a hit or a miss, stands for the same ray until the revision
   *  moves. `NaN`: none stands. */
  revision: number
  /** The cast's epoch (`ViewOriginCast.epoch`) the cast on its way was posted at: a session that
   *  ended answers none. */
  epoch: number
  /** A cast is on its way: one at a time. */
  inFlight: boolean
  /** Whether the view casts, as of its last plan. */
  casting: boolean
  /** The cast on its way was given up when the view stopped casting: its answer is of no one. */
  dropped: boolean
  /** Made once for the view, handed to each cast (`ViewOriginCast.post`). */
  readonly onHit: (hit: Uint32Array) => void
}

const slots = new WeakMap<WebgpuView, OriginCast>()
const forward = new Float64Array(3)
/** No offset: the eye. */
const NO_TARGET: ArrayLike<number> = new Float64Array(3)

/** A cast slot for `view`, answering into it and replaying the view on a change of the offset. */
function createCast(rt: WebgpuPagesRuntime, view: WebgpuView) {
  const cast: OriginCast = {
    offset: new Float64Array(3),
    eye: new Float64Array(3),
    forward: new Float64Array(3),
    reach: 0,
    ignore: undefined,
    revision: NaN,
    epoch: 0,
    inFlight: false,
    casting: false,
    dropped: false,
    onHit: (hit) => {
      cast.inFlight = false
      if (cast.dropped) {
        cast.dropped = false
        // It casts again by now: the frame plans again, and asks for its own ray.
        if (cast.casting) breakHeldFrame(rt, view)
        return
      }
      // Nothing met: the eye.
      const distance = rayHitDistance(hit, cast.reach) ?? 0
      let moved = false
      for (let k = 0; k < 3; k++) {
        const next = cast.forward[k] * distance
        moved ||= next !== cast.offset[k]
        cast.offset[k] = next
      }
      if (moved) breakHeldFrame(rt, view)
    },
  }
  return cast
}

/** A sun that casts a shadow this frame. */
const castsSun = (entry: VsmFrameLight) => vsmShadowed(entry) && entry.light.kind === 'directional'

/**
 * The offset, in metres from the eye, the view's clipmaps are centred on: the camera's `viewTarget`;
 * where it names none, the view's forward by the distance of the first body its line of sight
 * meets, asked of a frame that has a casting sun in `list`, and the last answer's. Zero where the
 * view is perspective or `shadowOrthoProjectViewOrigin` is off. A view asks again when its ray, the
 * body it passes through or the physics' world changed (`ViewOriginCast.revision`), a miss standing
 * as a hit does; at most one cast is on its way, which a session that ended no longer holds up
 * (`ViewOriginCast.epoch`).
 */
export function viewOriginTarget(
  rt: WebgpuPagesRuntime,
  cam: EngineCamera,
  list: readonly VsmFrameLight[],
  shadows: ShadowValues,
): ArrayLike<number> {
  if (cam.perspective !== 0 || !shadows.shadowOrthoProjectViewOrigin) return NO_TARGET
  // Each view casts its own ray into its own slot, a capture drawn aside as the main view.
  const view = rt.views.active
  const cast = rt.viewOriginCast
  let slot = slots.get(view)
  if (
    !cast ||
    !shadows.shadowOrthoRayCastViewOrigin ||
    !isZeroVector3(cam.viewTarget) ||
    !list.some(castsSun)
  ) {
    if (slot?.casting) {
      slot.casting = false
      // A cast on its way answers no one.
      slot.dropped = slot.inFlight
      slot.revision = NaN
      slot.offset.fill(0)
    }
    return cam.viewTarget
  }
  if (!slot) slots.set(view, (slot = createCast(rt, view)))
  slot.casting = true
  const epoch = cast.epoch()
  if (slot.inFlight) {
    if (slot.epoch === epoch) return slot.offset
    // The session that was asked ended, or another began, and answers no one.
    slot.inFlight = slot.dropped = false
    slot.revision = NaN
  }
  const reach = cam.far - cam.near,
    revision = cast.revision(),
    // The body the view is drawn from is the one its line of sight passes through.
    drawn = viewGroup(rt, view, 'run').lastCamera?.drawnFrom
  cameraForward(forward, cam.world)
  if (
    revision === slot.revision &&
    reach === slot.reach &&
    drawn === slot.ignore &&
    sameRange(cam.eye, slot.eye, 3) &&
    sameRange(forward, slot.forward, 3)
  )
    return slot.offset
  slot.inFlight = true
  slot.epoch = epoch
  slot.reach = reach
  slot.ignore = drawn
  slot.eye.set(cam.eye)
  slot.forward.set(forward)
  cast.post(slot.eye, slot.forward, reach, drawn, slot.onHit)
  // The post flushed the frame's commands, which moves the revision: the answer stands for the world
  // as flushed.
  slot.revision = cast.revision()
  return slot.offset
}

/** Hands the runtime the world's cast, or `null` when its physics stops. A cast that comes or goes
 *  ends the casts on their way — the session that would answer them is gone — and moves what the
 *  views that cast plan from: each is replayed once. A view that holds no slot plans from nothing
 *  the cast gives, and is left as it is. */
export function setViewOriginCast(rt: WebgpuPagesRuntime, cast: ViewOriginCast | null) {
  if (rt.viewOriginCast === (cast ?? undefined)) return
  rt.viewOriginCast = cast ?? undefined
  for (const view of [rt.views.main, ...rt.views.persistent]) {
    const slot = slots.get(view)
    if (!slot) continue
    slot.inFlight = slot.dropped = false
    slot.revision = NaN
    if (slot.casting) breakHeldFrame(rt, view)
  }
}
