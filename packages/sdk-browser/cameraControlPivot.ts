import { createChangeGate, createControlBase, type ControlBase } from './cameraControlBase.ts';
import { controlPose, readVector, writeVector } from './cameraControlPose.ts';
import { dollyDistance, panOffset, pixelWorldScale } from './cameraControlMath.ts';
import { clampNumber, RADIUS_EPSILON } from '../sdk-core/src/world/math/spherical.ts';
import { rotateByQuaternion } from '../sdk-core/src/math/matrix/quaternion.ts';
import type { ControlCamera, PivotCameraControls } from './cameraControlTypes.ts';

/**
 * THE PIVOT CORE, shared by the trackball and the planar pan-zoom: a camera, a point it keeps
 * at a bounded distance, and the two gestures that do not depend on how the camera turns —
 * panning the pivot across the view plane, and dollying towards it.
 *
 * It differs from the orbit controller on purpose: orbit REBUILDS the orientation from its two
 * angles, which is what makes it a turntable, whereas here the orientation is whatever the
 * camera carries — the trackball rotates it, the pan-zoom never touches it. Both read the pose
 * back before every gesture, so a host that moves the camera itself is obeyed.
 */
export interface PivotCore {
  base: ControlBase;
  api: PivotCameraControls;
  /** Eye, pivot, eye-to-pivot offset and orientation, refreshed by `sample`. */
  position: Float64Array;
  center: Float64Array;
  offset: Float64Array;
  orientation: Float64Array;
  height(): number;
  sample(): void;
  apply(): boolean;
  panBy(dx: number, dy: number): void;
  dolly(steps: number): void;
}

export function createPivotControls(camera: ControlCamera, surface: HTMLElement): PivotCore {
  const pose = controlPose(camera),
    base = createControlBase();
  const position = new Float64Array(3),
    center = new Float64Array(3),
    offset = new Float64Array(3),
    orientation = new Float64Array(4),
    pan = new Float64Array(3),
    moved = new Float64Array(10);
  // Eye, pivot AND orientation: a trackball seen from its pivot's axis turns the view without
  // moving a single point, and that spin is a change the host must redraw.
  const gate = createChangeGate(base, 10);
  const height = () => surface.clientHeight || 1;
  const sample = () => {
    pose.readPosition(position);
    pose.readOrientation(orientation);
    readVector(center, api.target);
    for (let i = 0; i < 3; i++) offset[i] = position[i] - center[i];
  };
  const apply = () => {
    let radius = Math.hypot(offset[0], offset[1], offset[2]);
    // A pivot reached exactly is no direction at all: back off along what the camera faces.
    if (radius <= RADIUS_EPSILON) {
      rotateByQuaternion(offset, orientation, 0, 0, 1);
      radius = 1;
    }
    const far = Math.max(api.maxDistance, api.minDistance, RADIUS_EPSILON);
    const kept = clampNumber(radius, Math.max(api.minDistance, RADIUS_EPSILON), far);
    for (let i = 0; i < 3; i++) position[i] = center[i] + (offset[i] * kept) / radius;
    pose.write(position, orientation);
    writeVector(api.target, center);
    moved.set(position);
    moved.set(center, 3);
    moved.set(orientation, 6);
    return gate(moved);
  };
  const api: PivotCameraControls = {
    ...base.api,
    object: pose.object,
    target: pose.vector(),
    minDistance: 0,
    maxDistance: Infinity,
    enableZoom: true,
    enablePan: true,
    rotateSpeed: 1,
    zoomSpeed: 1,
    update: () => {
      sample();
      return apply();
    },
  };
  return {
    base,
    api,
    position,
    center,
    offset,
    orientation,
    height,
    sample,
    apply,
    panBy(dx, dy) {
      if (!api.enablePan) return;
      sample();
      const distance = Math.hypot(offset[0], offset[1], offset[2]);
      panOffset(pan, orientation, dx, dy, pixelWorldScale(distance, pose.fov(), height()));
      for (let i = 0; i < 3; i++) center[i] += pan[i];
      apply();
    },
    dolly(steps) {
      if (!api.enableZoom) return;
      sample();
      const distance = Math.hypot(offset[0], offset[1], offset[2]) || 1;
      const kept = dollyDistance(distance, steps, api.zoomSpeed);
      for (let i = 0; i < 3; i++) offset[i] = (offset[i] * kept) / distance;
      apply();
    },
  };
}

/** Notches a pinch is worth: fingers apart zoom in, exactly as a wheel turned backwards. */
export function pinchSteps(ratio: number) {
  return ratio > 0 ? -Math.log(ratio) / Math.log(0.95) : 0;
}
