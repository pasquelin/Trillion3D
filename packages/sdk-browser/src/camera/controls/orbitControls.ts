import { PI, TAU } from '../../../../math/src/constants.ts'
import { sameValues } from '../../../../math/src/matrix/matrixElements.ts'
import { createPivotControls, keptDistance, panCenter, trackPivotGestures } from './pivot.ts'
import { clampAzimuth, dollyDistance, orbitOrientation } from './math.ts'
import { fromSpherical, POLAR_EPSILON, toSpherical } from '../../../../math/src/vector/spherical.ts'
import { clampCompare } from '../../../../math/src/scalar/reals.ts'
import type { ControlCamera, PivotCameraControls } from './types.ts'

/**
 * ORBIT, the turntable: the camera turns around `target` at a distance the host bounds, world
 * up kept, so a horizontal drag is an azimuth and a vertical one an elevation. Primary drag
 * rotates, secondary drag or two fingers pan, wheel and pinch zoom between `minDistance` and
 * `maxDistance`. No damping: a pointer that stops, stops the camera, and the scene is still.
 *
 * BUILT ON THE PIVOT CORE (`pivot.ts`): its pose, pivot, pan, gestures and change gate, the
 * orientation rebuilt from two angles where the core keeps the camera's own. The turntable keeps
 * its angles and distance as its state, read back from `object.position` and `target` only when
 * the pose is not the one it last wrote: a host that moves the camera itself — zoom buttons, say
 * — is understood on the next `update()`, and a still scene, its angles never re-derived from a
 * pose one ULP off a bound, emits nothing. The round trip is what `math.test.ts` pins down.
 *
 * THE ANGLES ARE BOUNDED like the distance, on every drag and every `update()`: the polar
 * angle between `minPolarAngle` and `maxPolarAngle`, the azimuth on the arc from
 * `minAzimuthAngle` to `maxAzimuthAngle`. Their names and meanings are the ones web 3D
 * libraries commonly use, so a page that already sets them keeps its numbers.
 */
export interface OrbitCameraControls extends PivotCameraControls {
  /**
   * Smallest polar angle, in radians from straight up: `0` lets the camera look straight
   * down. The pole itself stays out of reach, where the azimuth would stop being defined.
   */
  minPolarAngle: number
  /** Largest polar angle, in radians from straight up: `Math.PI / 2` keeps it above the ground. */
  maxPolarAngle: number
  /**
   * Start of the arc of azimuth allowed, in radians from +Z towards +X; unlimited at
   * `-Infinity`. Only a pair of finite bounds narrower than a full turn holds the camera.
   */
  minAzimuthAngle: number
  /** End of that arc; unlimited at `Infinity`. It may be smaller than `minAzimuthAngle`. */
  maxAzimuthAngle: number
  /**
   * Radians per second the camera turns around `target` on its own, azimuth from +Z towards +X;
   * 0, the default, holds it still. The turn is integrated by `update(delta)`, and it stops for
   * good at the first press or wheel notch on the surface: the viewer has taken the camera.
   */
  autoRotate: number
  /** As the pivot's `update()`, with the seconds `autoRotate` turns over; 0 by default. */
  update(delta?: number): boolean
}

/** An orbit's default angle limits and turn, which `world.controls` keeps as its own. */
export const ORBIT_DEFAULTS = {
  minPolarAngle: 0,
  maxPolarAngle: PI,
  minAzimuthAngle: -Infinity,
  maxAzimuthAngle: Infinity,
  autoRotate: 0,
}

/** The pivot's eye in spherical terms about its centre: read off the pose when something else
 *  moved it (`sample`), clamped to the orbit's limits and written back (`apply`). */
function createOrbitSpherical(core: ReturnType<typeof createPivotControls>) {
  const { position, center, offset, orientation } = core
  const spherical = new Float64Array(3),
    /** Eye, pivot and orientation as last written, and as read back. */
    written = new Float64Array(10),
    seen = new Float64Array(10)
  let posed = false
  const sample = () => {
    core.sample()
    seen.set(position)
    seen.set(center, 3)
    seen.set(orientation, 6)
    if (!posed || !sameValues(seen, written)) toSpherical(spherical, offset)
  }
  const apply = () => {
    const api = core.api as OrbitCameraControls
    spherical[0] = keptDistance(api, spherical[0])
    spherical[1] = clampAzimuth(spherical[1], api.minAzimuthAngle, api.maxAzimuthAngle)
    spherical[2] = clampCompare(
      spherical[2],
      Math.max(api.minPolarAngle, POLAR_EPSILON),
      Math.min(api.maxPolarAngle, PI - POLAR_EPSILON),
    )
    fromSpherical(offset, spherical)
    orbitOrientation(orientation, spherical)
    const changed = core.apply()
    written.set(position)
    written.set(center, 3)
    written.set(orientation, 6)
    posed = true
    return changed
  }
  return { spherical, sample, apply }
}

export function createOrbitCameraControls(
  camera: ControlCamera,
  surface: HTMLElement,
): OrbitCameraControls {
  const core = createPivotControls(camera, surface)
  const { base, pose, center, orientation } = core
  const { spherical, sample, apply } = createOrbitSpherical(core)
  const rotate = (dx: number, dy: number) => {
    sample()
    spherical[1] -= (TAU * dx * api.rotateSpeed) / core.height()
    spherical[2] -= (TAU * dy * api.rotateSpeed) / core.height()
    apply()
  }
  const panBy = (dx: number, dy: number) => {
    if (!api.enablePan) return
    sample()
    orbitOrientation(orientation, spherical)
    panCenter(center, orientation, pose, spherical[0], core.height(), dx, dy)
    apply()
  }
  const dolly = (steps: number) => {
    if (!api.enableZoom) return
    sample()
    spherical[0] = dollyDistance(spherical[0], steps, api.zoomSpeed)
    apply()
  }
  let spinning = true
  const update = (delta = 0) => {
    sample()
    if (spinning) spherical[1] += api.autoRotate * Math.max(0, delta)
    return apply()
  }
  // Unbounded angles by default: only the poles are out of reach. The core's own contract,
  // turned into the orbit's: its distance bounds are the ones `apply` reads.
  const api: OrbitCameraControls = Object.assign(core.api, { ...ORBIT_DEFAULTS, update })
  const interrupt = () => void (spinning = false)
  base.listen(surface, 'pointerdown', interrupt)
  base.listen(surface, 'wheel', interrupt)
  trackPivotGestures(
    surface,
    base,
    (dx, dy, button, event) => (button === 0 && !event.shiftKey ? rotate(dx, dy) : panBy(dx, dy)),
    panBy,
    dolly,
  )
  return api
}
