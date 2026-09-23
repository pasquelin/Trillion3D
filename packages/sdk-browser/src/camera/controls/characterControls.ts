import { createChangeGate, createControlBase } from './base.ts';
import { axisOf, trackKeys, type KeyAxis } from './input.ts';
import { controlPose } from './pose.ts';
import { createHead, HEAD_DEFAULTS, type PersonHead } from './look.ts';
import { createCharacterBody } from '../../../../sdk-core/src/collision/characterBody.ts';
import { createCharacterEye } from '../../../../sdk-core/src/collision/characterEye.ts';
import {
  HUMAN_BODY,
  type CharacterSettings,
} from '../../../../sdk-core/src/collision/characterSettings.ts';
import type { CharacterCollision } from '../../../../sdk-core/src/collision/characterCollision.ts';
import type { CameraControlBase, ControlCamera } from './types.ts';

/**
 * A CHARACTER, seen through its eyes: a body with mass that walks, runs, jumps and falls,
 * and collides with the world's triangles as an upright capsule.
 *
 * The pointer turns the head as in first person (`look.ts`). The keys, by `KeyboardEvent.code`
 * so every keyboard layout plays the same keys: W/S or the up and down arrows walk forward
 * and back, A/D or the side arrows strafe, Shift sprints, Space jumps. The body does not start
 * or stop at once: it gathers speed over `responseTime` and brakes over `stopTime`, keeps its
 * momentum in the air, rises under `gravity` and falls under `fallGravity`, climbs ledges up to
 * `stepHeight`, slides along walls and stands on slopes up to `maxSlope`
 * (`sdk-core/src/collision/characterBody.ts`).
 *
 * The camera is the eye, `eyeHeight` above the feet, bobbing with the stride by `headBob` and
 * dipping on a landing by `landingDip` (`sdk-core/src/collision/characterEye.ts`); both ride on
 * the eye after the body's step and never move the body. A host that moves the camera itself
 * teleports the body there, at rest. A still character — grounded, no speed, no key, no dip left
 * — emits nothing, so the scene stays still.
 */
export interface CharacterCameraControls extends CameraControlBase, PersonHead, CharacterSettings {
  /** The body's velocity in metres per second, live: `[x, y, z]`, y up. */
  readonly velocity: Readonly<Float64Array>;
  /** Whether the feet are on a floor. */
  readonly onGround: boolean;
  /** The stride's phase in radians, in [0, 2π): one foot strikes at 0, the other at π. */
  readonly stride: number;
  /** Called on landing with the downward speed, in metres per second: a sound, a shake. */
  onLand: ((impact: number) => void) | null;
  /** Called when the body leaves the ground on a jump. */
  onJump: (() => void) | null;
  /**
   * What the body collides with — the world's colliders, or a physics backend's world through
   * the same seam (`CharacterCollision`). `null` walks level where the body stands, never falls.
   */
  collision: CharacterCollision | null;
  /** Lives `delta` seconds; returns whether the camera moved, and emits `change` when it did. */
  update(delta?: number): boolean;
}

const STRAFE: KeyAxis = [
    ['KeyD', 'ArrowRight'],
    ['KeyA', 'ArrowLeft'],
  ],
  ADVANCE: KeyAxis = [
    ['KeyW', 'ArrowUp'],
    ['KeyS', 'ArrowDown'],
  ],
  SPRINT = ['ShiftLeft', 'ShiftRight'],
  JUMP = 'Space';

export function createCharacterCameraControls(
  camera: ControlCamera,
  surface: HTMLElement,
): CharacterCameraControls {
  const pose = controlPose(camera),
    base = createControlBase();
  const at = new Float64Array(3),
    written = new Float64Array(3).fill(NaN),
    orientation = new Float64Array(4),
    moved = new Float64Array(7);
  const gate = createChangeGate(base, 7);
  const input = { wishX: 0, wishZ: 0, sprint: false };
  let world: CharacterCollision | null = null;
  const api: CharacterCameraControls = {
    ...base.api,
    ...HUMAN_BODY,
    object: pose.object,
    ...HEAD_DEFAULTS,
    onLand: null,
    onJump: null,
    get velocity() {
      return body.velocity;
    },
    get onGround() {
      return body.onGround;
    },
    get stride() {
      return eye.stride;
    },
    get collision() {
      return world;
    },
    set collision(next) {
      world = next;
      body.setWorld(next);
    },
    locked: () => head.locked(),
    lock: () => head.lock(),
    unlock: () => head.unlock(),
    update(delta = 0) {
      pose.readPosition(at);
      if (!at.every((value, k) => value === written[k]))
        body.place(at[0], at[1] - api.eyeHeight, at[2]);
      const yaw = head.turn(orientation);
      const strafe = axisOf(keys, ...STRAFE),
        advance = axisOf(keys, ...ADVANCE);
      const sin = Math.sin(yaw),
        cos = Math.cos(yaw),
        length = Math.hypot(strafe, advance) || 1;
      input.wishX = (cos * strafe - sin * advance) / length;
      input.wishZ = (-sin * strafe - cos * advance) / length;
      input.sprint = SPRINT.some((code) => keys.has(code));
      const feet = body.advance(delta, input, events);
      written.set(feet);
      written[1] += api.eyeHeight + eye.offset(delta, body.velocity, body.onGround);
      pose.write(written, orientation);
      moved.set(written);
      moved.set(orientation, 3);
      return gate(moved);
    },
  };
  const body = createCharacterBody(api),
    eye = createCharacterEye(api);
  const events = {
    onLand: (impact: number) => (eye.land(impact), api.onLand?.(impact)),
    onJump: () => api.onJump?.(),
  };
  const head = createHead(pose, surface, base, api);
  let jumpHeld = false;
  const keys = trackKeys(
    surface,
    base,
    () => {
      if (keys.has(JUMP) && !jumpHeld) body.pressJump();
      jumpHeld = keys.has(JUMP);
      base.emit();
    },
    [STRAFE, ADVANCE, SPRINT, [JUMP]],
  );
  return api;
}
