/**
 * THE CAMERA-CONTROLLER CONTRACT. What a host holds when it asks the explorer for a camera
 * controller, and what a controller is allowed to know about the camera it poses.
 *
 * The controllers of this package are written against these structural shapes alone, never
 * against a host-library class: `test/integration/moteur-sans-three.test.ts` keeps every file
 * but the declared boundaries free of the host library, and the camera a host hands over
 * satisfies these shapes as it is. A host that brings its own vector type only has to offer
 * the same operations.
 *
 * `target`, `object.position`, `minDistance`, `maxDistance`, `enableZoom`, `update()`,
 * `addEventListener('change')` and `dispose()` are the ORBIT contract the learning portal
 * consumes (`site/lessons/engine-scene/cameraControls.ts`); nothing outside that list is part
 * of it. The other controllers publish the same base plus what their own motion needs.
 */

/** The vector operations a controller and its host perform on a position or a target. */
export interface ControlVector {
  x: number;
  y: number;
  z: number;
  set(x: number, y: number, z: number): this;
  copy(v: { x: number; y: number; z: number }): this;
  clone(): ControlVector;
  add(v: { x: number; y: number; z: number }): this;
  sub(v: { x: number; y: number; z: number }): this;
  length(): number;
  setLength(length: number): this;
  distanceTo(v: { x: number; y: number; z: number }): number;
  fromArray(array: ArrayLike<number>, offset?: number): this;
}

/** The orientation a controller writes, as the host stores it: `(x, y, z, w)`. */
export interface ControlQuaternion {
  x: number;
  y: number;
  z: number;
  w: number;
  set(x: number, y: number, z: number, w: number): unknown;
}

/**
 * The camera a controller poses: its LOCAL position and orientation, and the vertical field
 * a pan needs to turn pixels into world units. A controller never resolves a world pose —
 * that is the business of `cameraWorld.ts`, and a controller writes exactly where the host
 * would have written by hand.
 */
export interface ControlCamera {
  position: ControlVector;
  quaternion: ControlQuaternion;
  fov: number;
  updateMatrixWorld(force?: boolean): void;
}

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
}

/** A controller that turns around a point it keeps: orbit, trackball, planar pan-zoom. */
export interface PivotCameraControls extends CameraControlBase {
  /** The point the camera turns around and the pivot a zoom moves towards. */
  target: ControlVector;
  minDistance: number;
  maxDistance: number;
  enableZoom: boolean;
  enablePan: boolean;
  rotateSpeed: number;
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
