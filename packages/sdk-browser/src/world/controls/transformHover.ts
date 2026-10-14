import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import type { CanvasPoint } from '../core/worldRaycast.ts'
import type { TransformHost } from './transform.ts'
import type { TransformHandle } from './transformMath.ts'

/** The words of what an answer was asked under: the camera's world matrix, then the handles'. */
const VIEW_WORDS = 32

/** The camera's and the handles' world matrices, written into `into`. */
function viewOf(host: TransformHost, root: Object3D, into: Float64Array) {
  host.camera.updateWorldMatrix(true, false)
  root.updateWorldMatrix(true, false)
  into.set(host.camera.matrixWorld.elements, 0)
  into.set(root.matrixWorld.elements, 16)
}

/**
 * The hover query of a transform control: one ray of the world's query (`host.raycast`, the helper
 * marks included) in flight at a time, the latest point asked again once it lands, and each answer
 * handed to `found` — the handle the nearest hit is, or none. An answer holds for the view and the
 * handles it was asked under: after a frame where either moved — an orbit's damping, a camera the
 * page set, the handles fitted to a moving object — `follow` asks again at the pointer's last point,
 * the pointer still.
 */
export function hoverQuery(
  host: TransformHost,
  found: (handle: TransformHandle | null, at: CanvasPoint) => void,
  { handles, root }: { handles: ReadonlyMap<Object3D, TransformHandle>; root: Object3D },
) {
  let flying = false,
    next: CanvasPoint | null = null,
    live = true,
    last: CanvasPoint | null = null
  const asked = new Float64Array(VIEW_WORDS),
    now = new Float64Array(VIEW_WORDS)
  const query = (point: CanvasPoint) => {
    if (flying) return void (next = point)
    flying = true
    host
      .raycast(point, { helpers: true })
      .then(
        (hit) => live && found((hit && handles.get(hit.object)) ?? null, point),
        () => live && found(null, point),
      )
      .finally(() => {
        flying = false
        const latest = next
        next = null
        if (latest && live) query(latest)
      })
  }
  const ask = (point: CanvasPoint) => {
    last = point
    viewOf(host, root, asked)
    query(point)
  }
  return {
    ask,
    /** The pointer left the canvas: nothing to ask again. */
    leave() {
      last = null
    },
    /** After a frame: true, and the last point asked again, when the view or the handles moved
     *  since the answer was asked. */
    follow() {
      if (!last) return false
      viewOf(host, root, now)
      if (now.every((word, k) => word === asked[k])) return false
      ask(last)
      return true
    },
    dispose() {
      live = false
    },
  }
}
