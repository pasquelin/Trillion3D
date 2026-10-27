import { createChangeGate, createControlBase, surfaceHeight, type ControlBase } from './base.ts'
import { controlPose, writeVector, type ControlPose } from './pose.ts'
import { loadXyz } from '../../../../sdk-core/src/world/math/likes.ts'
import { trackPointers, trackWheel, type DragHandlers } from './input.ts'
import { dollyDistance, panOffset, WHEEL_STEP } from './math.ts'
import { RADIUS_EPSILON } from '../../../../math/src/vector/spherical.ts'
import { clampCompare } from '../../../../math/src/scalar/reals.ts'
import { rotateByQuaternion } from '../../../../math/src/quaternion/quaternion.ts'
import type { ControlCamera, PivotCameraControls } from './types.ts'
import { length3 } from '../../../../math/src/vector/vector.ts'

/**
 * THE PIVOT CORE, shared by the orbit, the trackball and the planar pan-zoom: a camera, a point it keeps
 * at a bounded distance, and the two gestures that do not depend on how the camera turns —
 * panning the pivot across the view plane, and dollying towards it.
 *
 * The orbit is built on it too, and REBUILDS the orientation from its two angles before `apply`,
 * which is what makes it a turntable; elsewhere the orientation is whatever the camera carries —
 * the trackball rotates it, the pan-zoom never touches it. Each reads the pose back before every
 * gesture, so a host that moves the camera itself is obeyed.
 */
export interface PivotCore {
  base: ControlBase
  pose: ControlPose
  api: PivotCameraControls
  /** Eye, pivot, eye-to-pivot offset and orientation, refreshed by `sample`. */
  position: Float64Array
  center: Float64Array
  offset: Float64Array
  orientation: Float64Array
  height(): number
  sample(): void
  apply(): boolean
  panBy(dx: number, dy: number): void
  dolly(steps: number): void
}

/** The eye put back on its offset from the pivot, at the distance the controls keep. A pivot
 *  reached exactly is no direction at all: back off along what the camera faces. An eye at the
 *  least distance kept (`keptDistance`, never under `RADIUS_EPSILON`) stays there. */
function seatEye(
  api: PivotCameraControls,
  eye: Pick<PivotCore, 'position' | 'center' | 'offset' | 'orientation'>,
) {
  const { position, center, offset, orientation } = eye
  let radius = length3(offset[0], offset[1], offset[2])
  if (radius < RADIUS_EPSILON) {
    rotateByQuaternion(offset, orientation, 0, 0, 1)
    radius = 1
  }
  const kept = keptDistance(api, radius)
  for (let i = 0; i < 3; i++) position[i] = center[i] + (offset[i] * kept) / radius
}

/** A drag of `(dx, dy)` pixels pans the pivot across the view plane. */
function panPivot(core: PivotCore, dx: number, dy: number) {
  const { api, center, orientation, pose, offset } = core
  if (!api.enablePan) return
  core.sample()
  panCenter(
    center,
    orientation,
    pose,
    length3(offset[0], offset[1], offset[2]),
    core.height(),
    dx,
    dy,
  )
  core.apply()
}

/** `steps` notches of the wheel move the eye along its offset from the pivot. */
function dollyPivot(core: PivotCore, steps: number) {
  const { api, offset } = core
  if (!api.enableZoom) return
  core.sample()
  const distance = length3(offset[0], offset[1], offset[2]) || 1
  const kept = dollyDistance(distance, steps, api.zoomSpeed)
  for (let i = 0; i < 3; i++) offset[i] = (offset[i] * kept) / distance
  core.apply()
}

export function createPivotControls(camera: ControlCamera, surface: HTMLElement): PivotCore {
  const pose = controlPose(camera),
    base = createControlBase()
  // The point it keeps the camera on goes with it: a controller that keeps none frames none.
  base.undo(() => camera.setViewTarget(null))
  const position = new Float64Array(3),
    center = new Float64Array(3),
    offset = new Float64Array(3),
    orientation = new Float64Array(4),
    moved = new Float64Array(10)
  const eye = { position, center, offset, orientation }
  // Eye, pivot AND orientation: a trackball seen from its pivot's axis turns the view without
  // moving a single point, and that spin is a change the host must redraw.
  const gate = createChangeGate(base, 10)
  const height = () => surfaceHeight(surface)
  const sample = () => {
    pose.readPosition(position)
    pose.readOrientation(orientation)
    loadXyz(center, api.target)
    for (let i = 0; i < 3; i++) offset[i] = position[i] - center[i]
  }
  const apply = () => {
    seatEye(api, eye)
    pose.write(position, orientation, center)
    writeVector(api.target, center)
    moved.set(position)
    moved.set(center, 3)
    moved.set(orientation, 6)
    return gate(moved)
  }
  const api = pivotControlsApi(base, pose, () => {
    sample()
    return apply()
  })
  const core: PivotCore = {
    base,
    pose,
    api,
    ...eye,
    height,
    sample,
    apply,
    panBy: (dx, dy) => panPivot(core, dx, dy),
    dolly: (steps) => dollyPivot(core, steps),
  }
  return core
}

/** Scratch offset of `panCenter`, which is not reentrant. */
const pan = new Float64Array(3)

/** Moves `center` across the view plane of a camera oriented by `orientation`, `distance` away
 *  from it, by a drag of `(dx, dy)` pixels on a surface `height` pixels tall: the scene follows
 *  the pointer. The pan of every pivot controller, the orbit's among them. */
export function panCenter(
  center: Float64Array,
  orientation: ArrayLike<number>,
  pose: ControlPose,
  distance: number,
  height: number,
  dx: number,
  dy: number,
) {
  panOffset(pan, orientation, dx, dy, pose.worldLength(distance, 1 / Math.max(1, height)))
  for (let i = 0; i < 3; i++) center[i] += pan[i]
}

/** `radius` held within the controls' distance range, and never under `RADIUS_EPSILON`. */
export function keptDistance(api: PivotCameraControls, radius: number) {
  const far = Math.max(api.maxDistance, api.minDistance, RADIUS_EPSILON)
  return clampCompare(radius, Math.max(api.minDistance, RADIUS_EPSILON), far)
}

/** A pivot's default distance range and speeds, which `world.controls` keeps as its own. */
export const PIVOT_DEFAULTS = {
  minDistance: 0,
  maxDistance: Infinity,
  rotateSpeed: 1,
  zoomSpeed: 1,
  // Both gestures on: among the settings `world.controls` keeps and hands to every controller it
  // makes (`CONTROL_SETTINGS`), so a page that turns one off keeps it off.
  enableZoom: true,
  enablePan: true,
}

/** The pivot contract at its defaults: unbounded distance, both gestures on, unit speeds. */
function pivotControlsApi(
  base: ControlBase,
  pose: ControlPose,
  update: () => boolean,
): PivotCameraControls {
  return {
    ...base.api,
    object: pose.object,
    target: pose.vector(),
    ...PIVOT_DEFAULTS,
    update,
  }
}

/**
 * The zoom gestures every pivot controller shares: a pinch pans by its midpoint and dollies by
 * its ratio, a wheel notch dollies — down pushes the camera away, as every viewer expects.
 */
export function trackPivotGestures(
  surface: HTMLElement,
  base: ControlBase,
  drag: DragHandlers['drag'],
  panBy: (dx: number, dy: number) => void,
  dolly: (steps: number) => void,
) {
  trackPointers(surface, base, {
    drag,
    pinch: (ratio, dx, dy) => {
      panBy(dx, dy)
      dolly(pinchSteps(ratio))
    },
  })
  trackWheel(surface, base, (steps) => dolly(-steps))
}

/** Notches a pinch is worth: fingers apart zoom in, exactly as a wheel turned backwards. */
function pinchSteps(ratio: number) {
  return ratio > 0 ? -Math.log(ratio) / Math.log(WHEEL_STEP) : 0
}
