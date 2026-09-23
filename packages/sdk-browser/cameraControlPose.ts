import type { ControlCamera, ControlVector } from './cameraControlTypes.ts';

/**
 * THE ONE PLACE A CONTROLLER TOUCHES A CAMERA. The controllers themselves only ever see the
 * flat numbers below, so `tests/integration/structure-moteur.test.ts` has a single file to
 * declare: a controller writes a LOCAL pose, exactly where a host writing the same motion by
 * hand would write it, and never resolves a world pose — that remains `cameraWorld.ts`.
 *
 * The vectors handed back are the HOST's own: `object.position` is the camera's live position,
 * and `vector()` clones it to make a target of the same kind. Nothing here names a host
 * library, and nothing allocates per frame beyond those two clones.
 */
export interface ControlPose {
  /** The camera as the contract exposes it; its `position` is live. */
  object: { position: ControlVector };
  /** A fresh vector of the host's kind, zeroed. */
  vector(): ControlVector;
  /** Vertical field of view, in degrees. */
  fov(): number;
  readPosition(out: Float64Array): Float64Array;
  readOrientation(out: Float64Array): Float64Array;
  /** Writes position and orientation back, then makes the camera's matrices current. */
  write(position: ArrayLike<number>, orientation: ArrayLike<number>): void;
}

export function controlPose(camera: ControlCamera): ControlPose {
  return {
    object: camera,
    vector: () => camera.position.clone().set(0, 0, 0),
    fov: () => camera.fov,
    readPosition(out) {
      out[0] = camera.position.x;
      out[1] = camera.position.y;
      out[2] = camera.position.z;
      return out;
    },
    readOrientation(out) {
      out[0] = camera.quaternion.x;
      out[1] = camera.quaternion.y;
      out[2] = camera.quaternion.z;
      out[3] = camera.quaternion.w;
      return out;
    },
    write(position, orientation) {
      camera.position.set(position[0], position[1], position[2]);
      camera.quaternion.set(orientation[0], orientation[1], orientation[2], orientation[3]);
      camera.updateMatrixWorld();
    },
  };
}

/** Reads a target into flat numbers, so the maths never sees a host vector. */
export function readVector(out: Float64Array, v: { x: number; y: number; z: number }) {
  out[0] = v.x;
  out[1] = v.y;
  out[2] = v.z;
  return out;
}

/** Writes flat numbers back into a host vector. */
export function writeVector(v: ControlVector, from: ArrayLike<number>) {
  v.set(from[0], from[1], from[2]);
  return v;
}
