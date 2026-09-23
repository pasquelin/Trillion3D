/**
 * THE CAMERA-CONTROLLER CONTRACT. What a host holds when it asks the explorer for a camera
 * controller, and what a controller is allowed to know about the camera it poses.
 *
 * The controllers of this package are written against these structural shapes alone, never
 * against a host-library class: `tests/integration/engine-without-three.test.ts` keeps every file
 * but the declared boundaries free of the host library, and the camera a host hands over
 * satisfies these shapes as it is. A host that brings its own vector type only has to offer
 * the same operations.
 *
 * `target`, `object.position`, `minDistance`, `maxDistance`, `enableZoom`, `update()`,
 * `addEventListener('change')` and `dispose()` are the ORBIT contract a world's `controls`
 * publishes (`world/core/worldCamera.ts`); nothing outside that list is part of it. The other controllers publish the same base plus what their own motion needs.
 */
import type { HostRotation } from '../../host/scene/graphNodes.ts';

/** The vector operations a controller and its host perform on a position or a target. */
export interface ControlVector {
  /** Left to right. */
  x: number;
  /** Bottom to top. */
  y: number;
  /** Back to front. */
  z: number;
  /** Sets the three numbers. */
  set(x: number, y: number, z: number): this;
  /** Takes another point's numbers. */
  copy(v: { x: number; y: number; z: number }): this;
  /** A copy. */
  clone(): ControlVector;
  /** Adds another vector. */
  add(v: { x: number; y: number; z: number }): this;
  /** Takes another vector away. */
  sub(v: { x: number; y: number; z: number }): this;
  /** Its length. */
  length(): number;
  /** Keeps the direction, sets the length. */
  setLength(length: number): this;
  /** Distance to a point. */
  distanceTo(v: { x: number; y: number; z: number }): number;
  /** Reads three numbers from a list. */
  fromArray(array: ArrayLike<number>, offset?: number): this;
}

/**
 * The camera a controller poses: its LOCAL position and orientation, and the vertical field and
 * zoom a pan needs to turn pixels into world units. A controller never resolves a world pose —
 * that is the business of `../world.ts`, and a controller writes exactly where the host
 * would have written by hand.
 */
export interface ControlCamera {
  position: ControlVector;
  /** The orientation the host stores, declared once in `../../host/scene/graphNodes.ts`. */
  quaternion: HostRotation;
  fov: number;
  /** Magnification, 1 when the host has none: a pan at zoom 2 moves half as far per pixel. */
  zoom?: number;
  updateMatrixWorld(force?: boolean): void;
}

/** A function called when a controller moves the camera. */
export type ChangeListener = () => void;

/** What every controller publishes, whatever it does with the pointer. */
export interface CameraControlBase {
  /** The posed camera, exposed as the host reads it: `object.position` is live. */
  object: { position: ControlVector };
  /** Registers a `change` listener; the only event type a controller emits. */
  addEventListener(type: 'change', listener: ChangeListener): void;
  removeEventListener(type: 'change', listener: ChangeListener): void;
  /** Removes every listener installed on the surface, once; calling it twice is a no-op. */
  dispose(): void;
  /**
   * `true` stops listening to the pointer, the wheel and the keys, and lets go of the keys held,
   * the pointers captured and the pointer lock; `false` listens again. Nothing else is touched:
   * the controller keeps its pose and its motion, and resumes from them.
   */
  pause(paused: boolean): void;
}

/** A controller that turns around a point it keeps: orbit, trackball, planar pan-zoom. */
export interface PivotCameraControls extends CameraControlBase {
  /** The point the camera turns around and the pivot a zoom moves towards. */
  target: ControlVector;
  /** Closest the camera may come. */
  minDistance: number;
  /** Farthest the camera may go. */
  maxDistance: number;
  /** Whether the wheel zooms. */
  enableZoom: boolean;
  /** Whether dragging slides the view. */
  enablePan: boolean;
  /** How fast dragging turns. */
  rotateSpeed: number;
  /** How fast the wheel zooms. */
  zoomSpeed: number;
  /**
   * Rewrites the camera from the pose the host may have edited — `object.position` and
   * `target` — clamped by `minDistance`/`maxDistance`. Returns whether anything moved, and
   * emits `change` exactly when it did: a still scene schedules no work.
   */
  update(): boolean;
}

/** A controller the host integrates over time: flight, first person. */
export interface SteeredCameraControls extends CameraControlBase {
  /** World units per second at full stick. */
  movementSpeed: number;
  /**
   * Integrates the keys held and the look accumulated since the last call over `delta`
   * SECONDS. Returns whether anything moved, and emits `change` exactly when it did.
   */
  update(delta?: number): boolean;
}
