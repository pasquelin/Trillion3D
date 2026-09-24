import { Vector3 } from '../../../../sdk-core/src/world/math/vector3.ts';
import { Quaternion } from '../../../../sdk-core/src/world/math/quaternion.ts';
import { Plane, type Ray } from '../../../../sdk-core/src/world/math/volumes.ts';

/** What a transform control does to its object. */
export type TransformMode = 'translate' | 'rotate' | 'scale';
/** The frame the handles are aligned with; a scale is always along the object's own axes. */
export type TransformSpace = 'world' | 'local';
/** A handle: one axis, the plane of two, or `'xyz'` — the centre: free move, uniform scale. */
export type TransformHandle = 'x' | 'y' | 'z' | 'xy' | 'yz' | 'xz' | 'xyz';
/** Steps a drag is rounded to, each optional: world units, radians, scale factor. */
export type TransformSnap = {
  /** World units a move is rounded to, along each axis. */
  translate?: number;
  /** Radians a turn is rounded to. */
  rotate?: number;
  /** The step a scale factor is rounded to. */
  scale?: number;
};

/** A drag as it began: the handle, the object's world position and turn and its own scale, the
 *  unit view direction toward the object, the pointer's first ray, the view's world up and the
 *  handles' world length — the view's own unit a uniform scale is read in. */
export type DragStart = {
  mode: TransformMode;
  handle: TransformHandle;
  space: TransformSpace;
  position: Vector3;
  quaternion: Quaternion;
  scale: Vector3;
  view: Vector3;
  from: Ray;
  up: Vector3;
  reach: number;
};

/** The object's pose a drag asks for: world position and turn, and its own scale. */
export type DragPose = { position: Vector3; quaternion: Quaternion; scale: Vector3 };

const UNIT = { x: new Vector3(1, 0, 0), y: new Vector3(0, 1, 0), z: new Vector3(0, 0, 1) };
const round = (value: number, step?: number) => (step ? Math.round(value / step) * step : value);

/** A handle's axis as a world direction: turned with the object in local space, and always for
 *  a scale, which acts along the object's own axes. */
function handleAxis(start: DragStart, name: 'x' | 'y' | 'z') {
  const axis = UNIT[name].clone();
  return start.space === 'local' || start.mode === 'scale'
    ? axis.applyQuaternion(start.quaternion)
    : axis;
}

/** Where a ray meets the plane of `normal` through `point`, or null when it never does ahead. */
function onPlane(ray: Ray, normal: Vector3, point: Vector3) {
  const t = ray.distanceToPlane(new Plane().setFromNormalAndCoplanarPoint(normal, point));
  return t === null ? null : ray.at(t);
}

/** The plane a drag along `axis` slides on: the one holding the axis that faces the view most. */
function axisPlane(axis: Vector3, view: Vector3) {
  return axis.clone().cross(view.clone().cross(axis)).normalize();
}

/**
 * The pose a drag from `start.from` to `to` asks for, rounded to `snap`; null when the pointer
 * left every plane the drag can be read on (an axis seen end-on, a plane seen edge-on).
 *
 * Every mode reads the two rays on one plane through the object: an axis on the plane that holds
 * it and faces the view most, a plane handle on itself, a ring on the plane it turns in, the
 * centre on the plane facing the view. Only the change is rounded: a translation by whole steps
 * along each axis, a turn by whole angle steps, a scale to whole scale steps.
 */
export function dragTransform(
  start: DragStart,
  to: Ray,
  snap: TransformSnap = {},
): DragPose | null {
  const { mode, handle, position: p0, view } = start;
  const pose = {
    position: p0.clone(),
    quaternion: start.quaternion.clone(),
    scale: start.scale.clone(),
  };
  const axes = (handle === 'xyz' ? [] : [...handle]) as ('x' | 'y' | 'z')[];
  const single = handle.length === 1 ? handleAxis(start, handle as 'x') : null;
  const normal =
    handle === 'xyz'
      ? view.clone()
      : mode === 'rotate'
        ? single!
        : single
          ? axisPlane(single, view)
          : handleAxis(
              start,
              (['x', 'y', 'z'] as const).find((c) => !handle.includes(c))!,
            );
  const size = normal.lengthSq();
  if (!Number.isFinite(size) || size === 0) return null;
  const a = onPlane(start.from, normal, p0),
    b = onPlane(to, normal, p0);
  if (!a || !b) return null;
  const moved = b.clone().sub(a);
  if (mode === 'translate') {
    if (handle === 'xyz') return { ...pose, position: p0.clone().add(moved) };
    for (const name of axes) {
      const axis = handleAxis(start, name);
      pose.position.addScaledVector(axis, round(moved.dot(axis), snap.translate));
    }
    return pose;
  }
  const v0 = a.clone().sub(p0),
    v1 = b.clone().sub(p0);
  if (mode === 'rotate') {
    const angle = Math.atan2(v0.clone().cross(v1).dot(normal), v0.dot(v1));
    const turn = new Quaternion().setFromAxisAngle(normal, round(angle, snap.rotate));
    pose.quaternion.premultiply(turn);
    return pose;
  }
  // A drag through the centre never turns the object inside out: a size that would reach zero
  // or change sign keeps the one the drag started from.
  const scaled = (factor: number, name: 'x' | 'y' | 'z') => {
    const s = round(start.scale[name] * factor, snap.scale);
    pose.scale[name] = s * start.scale[name] > 0 ? s : start.scale[name];
  };
  if (handle === 'xyz') {
    // Read on the screen's up, whatever point of the centre was pressed: a drag up by the
    // handles' length multiplies the size by e, as far down divides it by e.
    const up = start.up.clone().addScaledVector(normal, -start.up.dot(normal)).normalize();
    const factor = Math.exp(moved.dot(up) / start.reach);
    for (const name of ['x', 'y', 'z'] as const) scaled(factor, name);
    return pose;
  }
  for (const name of axes) {
    const axis = handleAxis(start, name),
      from = v0.dot(axis);
    if (from !== 0) scaled(v1.dot(axis) / from, name);
  }
  return pose;
}
