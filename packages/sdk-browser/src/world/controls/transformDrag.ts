import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import { Quaternion } from '../../../../sdk-core/src/world/math/quaternion.ts'
import { Ray } from '../../../../sdk-core/src/world/math/volumes.ts'
import { createControlBase } from '../../camera/controls/base.ts'
import { canvasRay, type CanvasPoint } from '../core/worldRaycast.ts'
import type { buildTransformHandles } from './transformHandles.ts'
import { hoverQuery } from './transformHover.ts'
import type { TransformEvent, TransformHost } from './transform.ts'
import {
  dragTransform,
  type DragPose,
  type DragStart,
  type TransformHandle,
  type TransformSnap,
} from './transformMath.ts'

/** Scratch values of a pointer move; a press keeps its own copy of the ray. */
const moveRay = new Ray(),
  parentTurn = new Quaternion()
/** The colour of the handle being dragged. */
const ACTIVE = 0xffff00
/** How far, in CSS pixels, a press may lie from the point the latest answer was asked for and still
 *  take it: a press past it waits for an answer of its own. */
const HOVER_SLACK = 4
/** The material a handle wears: its axis, the axis a plane square faces, or the centre's. */
const colourOf = (h: TransformHandle): 'x' | 'y' | 'z' | 'xyz' =>
  h.length !== 2 ? (h as 'x') : (['x', 'y', 'z'] as const).find((c) => !h.includes(c))!

/** What the pointer reads of the control it drives. */
type Control = {
  object: () => Object3D | null
  /** The drag that begins on `handle` along the first ray `from`. */
  start: (handle: TransformHandle, from: Ray) => DragStart
  snap: () => TransformSnap
  fit: () => void
  emit: (type: TransformEvent) => void
}

/**
 * The pointer of a transform control. The pointer's hover is picked as it moves (`hovering`): the
 * world's ray query (`world.raycast`, the handles included) answers a frame or so later, one ray in
 * flight at a time, the last position asked again when it lands. A handle is under the pointer when
 * the NEAREST thing the ray meets is one: the handles are drawn depth-tested in the same geometry,
 * so what hides one from the eye hides it from the pointer too. A press — a capture listener, heard
 * before the camera controller on the same canvas — takes the latest answer: on a handle, it is
 * kept from every later listener, the camera resting for the whole drag, its controller never
 * having heard it; `preventDefault` and `stopImmediatePropagation` are called at once, never after
 * an answer. A press with no answer — a touch, which has no hover — asks one, for the next press.
 * Each move writes the pose `dragTransform` asks for, through the object's parents; the release
 * restores the handle's colour. A press beside the handles is left alone.
 */
export function trackTransformDrag(
  host: TransformHost,
  parts: ReturnType<typeof buildTransformHandles>,
  control: Control,
) {
  const base = createControlBase()
  let drag: { start: DragStart; pointer: number } | null = null
  /** The handle the latest answer found nearest under the pointer, and the point it was asked at. */
  let hovered: { handle: TransformHandle; at: CanvasPoint } | null = null
  const pointOf = (event: PointerEvent): CanvasPoint => {
    const box = host.canvas.getBoundingClientRect()
    return { x: event.clientX - box.left, y: event.clientY - box.top }
  }
  const rayAt = (event: PointerEvent) =>
    canvasRay(host.camera, host.canvas, pointOf(event), moveRay)
  const hovering = hoverQuery(host, (handle, at) => (hovered = handle && { handle, at }), parts)
  /** The handle the latest answer holds at `point`, or none. */
  const handleAt = (point: CanvasPoint) =>
    hovered &&
    Math.abs(hovered.at.x - point.x) <= HOVER_SLACK &&
    Math.abs(hovered.at.y - point.y) <= HOVER_SLACK
      ? hovered.handle
      : null
  /** Writes a world pose on the object: the local pose that places it so under its parents. */
  const apply = (object: Object3D, { position, quaternion, scale }: DragPose) => {
    const parent = object.parent
    if (parent) {
      parent.worldToLocal(position)
      quaternion.premultiply(parent.getWorldQuaternion(parentTurn).invert())
    }
    object.position.copy(position)
    object.quaternion.copy(quaternion)
    object.scale.copy(scale)
  }
  const paint = (handle: TransformHandle, colour?: number) => {
    const key = colourOf(handle)
    parts.materials[key].color.set(colour ?? parts.colours[key])
  }
  const press = (event: PointerEvent) => {
    if (!control.object() || drag || event.button !== 0) return
    const point = pointOf(event),
      handle = handleAt(point)
    if (!handle) return void hovering.ask(point)
    control.fit()
    const ray = rayAt(event)
    event.stopImmediatePropagation()
    event.preventDefault()
    host.canvas.setPointerCapture?.(event.pointerId)
    drag = { start: control.start(handle, ray.clone()), pointer: event.pointerId }
    paint(handle, ACTIVE)
    control.emit('dragStart')
  }
  base.listen<PointerEvent>(host.canvas, 'pointerdown', press, { capture: true })
  base.listen<PointerEvent>(host.canvas, 'pointerleave', () => {
    hovered = null
    hovering.leave()
  })
  base.listen<PointerEvent>(host.canvas, 'pointermove', (event) => {
    const object = control.object()
    if (!drag && object) hovering.ask(pointOf(event))
    if (!drag || !object || event.pointerId !== drag.pointer) return
    const pose = dragTransform(drag.start, rayAt(event), control.snap())
    if (!pose) return
    apply(object, pose)
    control.fit()
    control.emit('change')
  })
  /** Ends the drag under way, if any: the pointer let go, the handle's colour back, `dragEnd`. */
  const end = () => {
    if (!drag) return
    host.canvas.releasePointerCapture?.(drag.pointer)
    paint(drag.start.handle)
    drag = null
    control.emit('dragEnd')
  }
  const release = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointer) return
    end()
    // The handle moved under the pointer with its object: the next press reads where it rests.
    hovering.ask(pointOf(event))
  }
  base.listen<PointerEvent>(host.canvas, 'pointerup', release)
  base.listen<PointerEvent>(host.canvas, 'pointercancel', release)
  return {
    dragging: () => drag !== null,
    end,
    /** After a frame: the answer under a pointer the view or the handles moved beneath is dropped,
     *  and asked again (`hoverQuery`); a press before it lands asks its own. */
    follow() {
      if (!drag && control.object() && hovering.follow()) hovered = null
    },
    /** Removes every listener from the canvas; an answer still on its way is dropped. */
    dispose() {
      hovering.dispose()
      base.api.dispose()
    },
  }
}
