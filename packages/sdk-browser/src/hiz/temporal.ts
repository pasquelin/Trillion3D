import type { EngineCamera } from '../camera/world.ts'

/** Same tolerance, same walk, without allocating: `Array.prototype.every` asked for a closure
 *  per compared matrix, twice per call and every frame. */
function presqueEgaux(a: ArrayLike<number>, b: ArrayLike<number>) {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (!(Math.abs(a[i] - b[i]) <= 1e-7)) return false
  return true
}

/** The view the GPU partition's occluder history was taken from is this one: any camera movement,
 *  cut or projection change lets every row leave the occluders again (`hizViewMoved`). */
export function sameHizView(previous: EngineCamera | undefined, current: EngineCamera) {
  if (!previous) return false
  // `previous` is the camera `holdCameraWorld` holds: the same sixteen view and projection
  // numbers the frame entry copied, with nothing to walk up or invert again.
  return (
    presqueEgaux(previous.view, current.view) &&
    presqueEgaux(previous.projection, current.projection)
  )
}
