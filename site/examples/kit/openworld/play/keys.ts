import type { Input } from './input.ts';
import type { Inputs } from './protocol.ts';
import type { Mode } from './types.ts';

/**
 * The keys of each mode, and the line of help the HUD shows for it. One table, so the hints can
 * never say something the keys do not do.
 */
export const KEYS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  run: ['ShiftLeft', 'ShiftRight'],
  crouch: ['KeyC'],
  jump: 'Space',
  brake: ['Space'],
  throttleUp: ['KeyR', 'ArrowUp'],
  throttleDown: ['KeyF', 'ArrowDown'],
  yawLeft: ['KeyZ', 'ArrowLeft'],
  yawRight: ['KeyX', 'ArrowRight'],
  use: 'KeyE',
  view: 'KeyV',
} as const;

export const HINTS: Record<Mode, string> = {
  foot: 'W A S D walk · Shift run · Space jump · C crouch · E get in a vehicle',
  car: 'W accelerate · S brake and reverse · A D steer · Space handbrake · V view · E get out',
  plane: 'R F throttle · W S pitch · A D roll · Z X rudder · V view · E get out (stopped)',
};

/** Look angles the page owns: the head on foot, the camera's orbit in a vehicle. */
export type Look = { yaw: number; pitch: number };

/** The inputs the worker reads this frame, from the keys held in `mode`. */
export function readInputs(keys: Input, mode: Mode, look: Look): Inputs {
  const k = KEYS;
  const forward = keys.axis(k.forward, k.back);
  const right = keys.axis(k.right, k.left);
  const plane = mode === 'plane';
  return {
    forward: plane ? 0 : forward,
    right: plane ? 0 : right,
    run: keys.held(...k.run),
    crouch: mode === 'foot' && keys.held(...k.crouch),
    jump: keys.presses(k.jump),
    use: keys.presses(k.use),
    brake: mode === 'car' && keys.held(...k.brake),
    throttle: plane ? keys.axis(k.throttleUp, k.throttleDown) : 0,
    // Nose down with W as with a stick pushed forward, up with S.
    pitch: plane ? keys.axis(['KeyS'], ['KeyW']) : 0,
    roll: plane ? keys.axis(['KeyD'], ['KeyA']) : 0,
    yaw: plane ? keys.axis(k.yawRight, k.yawLeft) : 0,
    lookYaw: look.yaw,
    lookPitch: look.pitch,
  };
}
