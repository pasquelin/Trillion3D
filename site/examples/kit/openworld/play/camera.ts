import {
  approach,
  clamp,
  lerp,
  multiply,
  rotate,
  yawPitchRoll,
  headingOf,
  type Q,
} from './math3.ts';
import type { CameraNode, Mode, Vec3 } from './types.ts';

/**
 * The camera of each mode. On foot: the eye at 1.7 m (1.1 m crouched, eased between the two),
 * turned by the mouse, with a head bob whose rhythm is the stride's: two steps per cycle, each
 * as long as the walker's pace makes it, a little higher and quicker running, nothing standing
 * still. In a vehicle: a chase view that follows with a short lag, or the driver's seat.
 */
export type CameraState = {
  eye: number;
  /** Stride phase, radians: one full turn is two steps. */
  phase: number;
  /** How much the head bobs, eased in and out as walking starts and stops. */
  bob: number;
  chase: [number, number, number] | null;
  cockpit: boolean;
};

export const cameraState = (): CameraState => ({
  eye: 1.7,
  phase: 0,
  bob: 0,
  chase: null,
  cockpit: false,
});

/** Stride length at a walking pace, metres; it grows with speed, as a person's does. */
export const strideAt = (speed: number) => 0.62 + 0.16 * speed;

/** The head bob's offset (up, sideways) in metres at `phase`, for a bob weight `bob`. */
export function headBob(phase: number, bob: number, running: boolean): [number, number] {
  const height = running ? 0.045 : 0.022;
  return [
    -Math.abs(Math.sin(phase)) * height * bob * 2 + height * bob,
    Math.sin(phase) * height * 0.5 * bob,
  ];
}

export type Frame = {
  mode: Mode;
  /** The player: feet on foot, the body in a vehicle. */
  at: [number, number, number];
  /** The vehicle's orientation (car, plane). */
  turn: Q;
  speed: number;
  crouched: boolean;
  running: boolean;
  grounded: boolean;
  look: { yaw: number; pitch: number };
  /** The vehicle's eye anchor, in its own frame. */
  seat: Vec3 | null;
};

const CHASE: Record<'car' | 'plane', [number, number, number]> = {
  car: [0, 2.3, 7],
  plane: [0, 5, 20],
};

export function placeCamera(camera: CameraNode, state: CameraState, frame: Frame, dt: number) {
  const { at, look } = frame;
  if (frame.mode === 'foot') {
    state.chase = null;
    state.eye = lerp(state.eye, frame.crouched ? 1.1 : 1.7, approach(dt, 0.12));
    const moving = frame.grounded && frame.speed > 0.3;
    state.bob = lerp(state.bob, moving ? Math.min(1, frame.speed / 1.4) : 0, approach(dt, 0.2));
    state.phase += (frame.speed / strideAt(frame.speed)) * Math.PI * dt;
    const [up, side] = headBob(state.phase, state.bob, frame.running);
    camera.position.set(
      at[0] + Math.cos(look.yaw) * side,
      at[1] + state.eye + up,
      at[2] - Math.sin(look.yaw) * side,
    );
    camera.quaternion.set(...yawPitchRoll(look.yaw, look.pitch));
    return;
  }
  if (state.cockpit && frame.seat) {
    const seat = rotate(frame.turn, frame.seat);
    camera.position.set(at[0] + seat[0], at[1] + seat[1], at[2] + seat[2]);
    camera.quaternion.set(...multiply(frame.turn, yawPitchRoll(look.yaw, look.pitch)));
    return;
  }
  // Behind the vehicle's heading (and, for the plane, its pitch), turned further by the mouse.
  const forward = rotate(frame.turn, [0, 0, -1]);
  const heading = headingOf(forward[0], forward[2]);
  const pitch = frame.mode === 'plane' ? Math.asin(clamp(forward[1], -1, 1)) * 0.6 : 0;
  const orbit = yawPitchRoll(heading + look.yaw, pitch + clamp(look.pitch, -0.5, 1) * 0.5 - 0.12);
  const back = rotate(orbit, CHASE[frame.mode]);
  const wanted: [number, number, number] = [at[0] + back[0], at[1] + back[1], at[2] + back[2]];
  const chase = state.chase ?? wanted;
  const k = approach(dt, 0.08);
  for (let i = 0; i < 3; i++) chase[i] = lerp(chase[i], wanted[i], k);
  state.chase = chase;
  camera.position.set(...chase);
  const aim = [at[0] - chase[0], at[1] + 1 - chase[1], at[2] - chase[2]];
  const length = Math.hypot(aim[0], aim[1], aim[2]) || 1;
  camera.quaternion.set(...yawPitchRoll(headingOf(aim[0], aim[2]), Math.asin(aim[1] / length)));
}
