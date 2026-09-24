import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';
import { raycast } from '../../../../sdk-core/src/world/object/raycast.ts';
import { Quaternion } from '../../../../sdk-core/src/world/math/quaternion.ts';
import { Ray } from '../../../../sdk-core/src/world/math/volumes.ts';
import { createControlBase } from '../../camera/controls/base.ts';
import { canvasRay } from '../core/worldRaycast.ts';
import { isHelper } from '../helper/mark.ts';
import type { buildTransformHandles } from './transformHandles.ts';
import type { TransformEvent, TransformHost } from './transform.ts';
import {
  dragTransform,
  type DragPose,
  type DragStart,
  type TransformHandle,
  type TransformSnap,
} from './transformMath.ts';

/** Scratch values of a pointer move; a press keeps its own copy of the ray. */
const moveRay = new Ray(),
  parentTurn = new Quaternion();
/** The colour of the handle being dragged. */
const ACTIVE = 0xffff00;
/** The material a handle wears: its axis, the axis a plane square faces, or the centre's. */
const colourOf = (h: TransformHandle): 'x' | 'y' | 'z' | 'xyz' =>
  h.length !== 2 ? (h as 'x') : (['x', 'y', 'z'] as const).find((c) => !h.includes(c))!;

/** What the pointer reads of the control it drives. */
type Control = {
  object: () => Object3D | null;
  /** The drag that begins on `handle` along the first ray `from`. */
  start: (handle: TransformHandle, from: Ray) => DragStart;
  snap: () => TransformSnap;
  fit: () => void;
  emit: (type: TransformEvent) => void;
};

/**
 * The pointer of a transform control. A press is picked on the handles first — a capture
 * listener, heard before the camera controller on the same canvas — and one that hits a handle is
 * kept from every later listener: the camera rests for the whole drag, its controller never having
 * heard the press; a handle hidden behind the scene's own triangles is not picked. Each move
 * writes the pose `dragTransform` asks for, through the object's parents; the release restores
 * the handle's colour. A press beside the handles is left alone.
 */
export function trackTransformDrag(
  host: TransformHost,
  parts: ReturnType<typeof buildTransformHandles>,
  control: Control,
) {
  const base = createControlBase();
  let drag: { start: DragStart; pointer: number } | null = null;
  const rayAt = (event: PointerEvent) => {
    const box = host.canvas.getBoundingClientRect();
    const at = { x: event.clientX - box.left, y: event.clientY - box.top };
    return canvasRay(host.camera, host.canvas, at, moveRay);
  };
  /** Writes a world pose on the object: the local pose that places it so under its parents. */
  const apply = (object: Object3D, { position, quaternion, scale }: DragPose) => {
    const parent = object.parent;
    if (parent) {
      parent.worldToLocal(position);
      quaternion.premultiply(parent.getWorldQuaternion(parentTurn).invert());
    }
    object.position.copy(position);
    object.quaternion.copy(quaternion);
    object.scale.copy(scale);
  };
  /** Whether a triangle of the scene stands nearer than `distance` along `ray`: the handles are
   *  drawn depth-tested, so what hides one from the eye hides it from the pointer too. A loaded
   *  model, hit on its box alone, hides nothing. */
  const hidden = (ray: Ray, distance: number) =>
    raycast(host.scene, ray, isHelper).some((hit) => hit.face >= 0 && hit.distance < distance);
  const paint = (handle: TransformHandle, colour?: number) => {
    const key = colourOf(handle);
    parts.materials[key].color.set(colour ?? parts.colours[key]);
  };
  const press = (event: PointerEvent) => {
    if (!control.object() || drag || event.button !== 0) return;
    control.fit();
    const ray = rayAt(event);
    const hit = raycast(parts.root, ray)[0];
    if (!hit || hidden(ray, hit.distance)) return;
    event.stopImmediatePropagation();
    event.preventDefault();
    host.canvas.setPointerCapture?.(event.pointerId);
    const handle = parts.handles.get(hit.object)!;
    drag = { start: control.start(handle, ray.clone()), pointer: event.pointerId };
    paint(handle, ACTIVE);
    control.emit('dragStart');
  };
  base.listen<PointerEvent>(host.canvas, 'pointerdown', press, { capture: true });
  base.listen<PointerEvent>(host.canvas, 'pointermove', (event) => {
    const object = control.object();
    if (!drag || !object || event.pointerId !== drag.pointer) return;
    const pose = dragTransform(drag.start, rayAt(event), control.snap());
    if (!pose) return;
    apply(object, pose);
    control.fit();
    control.emit('change');
  });
  /** Ends the drag under way, if any: the pointer let go, the handle's colour back, `dragEnd`. */
  const end = () => {
    if (!drag) return;
    host.canvas.releasePointerCapture?.(drag.pointer);
    paint(drag.start.handle);
    drag = null;
    control.emit('dragEnd');
  };
  const release = (event: PointerEvent) => {
    if (drag && event.pointerId === drag.pointer) end();
  };
  base.listen<PointerEvent>(host.canvas, 'pointerup', release);
  base.listen<PointerEvent>(host.canvas, 'pointercancel', release);
  return {
    dragging: () => drag !== null,
    end,
    /** Removes every listener from the canvas. */
    dispose: base.api.dispose,
  };
}
