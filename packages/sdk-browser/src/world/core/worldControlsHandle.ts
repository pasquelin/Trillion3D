import { Vector3 } from '../../../../sdk-core/src/world/math/vector3.ts';
import { worldControls, type WorldControls } from './worldCamera.ts';
import type { Camera } from '../../../../sdk-core/src/world/camera/camera.ts';
import { CONTROL_SETTINGS, type ControlSetting, type Controller } from './worldControlsSettings.ts';
import { controlSettingAccessors } from './worldControlsAccessors.ts';
import { characterSettingAccessors } from './worldCharacterAccessors.ts';
import { controlTargets, noVehicle, type CharacterSource } from './worldControlTargets.ts';

/**
 * `world.controls`: the controller driving the world's camera from the canvas, live. Changing
 * `kind` releases the one in place and makes the next; `enabled` pauses it; a gesture redraws.
 *
 * THE LIMITS AND SPEEDS BELONG TO THE HANDLE, not to the controller in place: a write is kept,
 * handed to the live controller when it has that setting, and handed again to every controller
 * `kind` makes later. A controller without that setting ignores it — the distances bound the
 * pivot controllers (orbit, trackball, pan-zoom), the angles and `autoRotate` the orbit alone;
 * `movementSpeed` drives flight and first person, `lookSpeed` those two and the character,
 * `minPitch` and `maxPitch` first person and the character, the turn speeds, the stick inputs, `inputResponse`, `autoForward`
 * and `pointerLook` flight, `rotateSpeed` and `zoomSpeed` the pivot controllers, the body,
 * speeds, jump and hooks the character — so a page may set them before or after it picks its
 * controller. The character's `colliders` are kept the same way: the triangle tree is built
 * once when they are set, handed to every character `kind` makes, and rebuilt only on
 * `rebuildColliders()`. With the world's physics on, the character's body is Jolt's and meets
 * the simulation's bodies instead (`physics` below). A cruising flight or a turning orbit moves on every frame, so the
 * handle asks for the first one; a paused controller, or any other kind, leaves the scene
 * still.
 */
export function worldControlsHandle(
  initial: WorldControls,
  camera: () => Camera,
  surface: HTMLElement,
  invalidate: () => void,
  physics: CharacterSource | null = null,
) {
  let kind = initial,
    enabled = true,
    current: Controller | null = null;
  const standingTarget = new Vector3(),
    settings = { ...CONTROL_SETTINGS };
  /** Whether the controller in place moves on its own — cruising, a stick input held, a turn —
   *  and so is sent its first frame; the ones after follow from its own `change`. */
  const wake = (live: Record<string, unknown>) => {
    const moving = live.autoForward === true || live.pitchInput || live.yawInput || live.rollInput;
    if (enabled && (moving || live.autoRotate)) invalidate();
  };
  /** Hands every kept setting to the controller in place, where it has them. */
  const bound = () => {
    const live = current as Record<string, unknown> | null;
    if (!live) return;
    for (const name of Object.keys(settings) as ControlSetting[])
      if (name in live) live[name] = settings[name];
    targets.bind(live);
    wake(live);
  };
  const setting = <K extends ControlSetting>(name: K, value: (typeof CONTROL_SETTINGS)[K]) => {
    settings[name] = value;
    const live = current as Record<string, unknown> | null;
    if (live && name in live) {
      live[name] = value;
      wake(live);
    }
    // A pivot controller re-reads its pose under the new setting, and redraws if it moved.
    if (enabled && current?.target) current.update?.();
  };
  const rebuild = () => {
    standingTarget.copy(current?.target ?? standingTarget);
    current?.dispose();
    current = worldControls(kind, camera(), surface) as Controller | null;
    current?.pause(!enabled);
    bound();
    if (current?.target) {
      current.target.copy(standingTarget);
      if (enabled) current.update?.();
    }
    current?.addEventListener('change', invalidate);
  };
  const targets = controlTargets(
    physics,
    () => {
      targets.bind(current as Record<string, unknown> | null);
      invalidate();
    },
    () => kind === 'vehicle',
  );
  // The world's physics started or stopped: the character's body follows it.
  physics?.watch(() => {
    targets.bind(current as Record<string, unknown> | null);
    invalidate();
  });
  rebuild();
  const handle = {
    /** Which controller steers the camera; set another name to switch. */
    get kind() {
      return kind;
    },
    set kind(next: WorldControls) {
      if (next === 'vehicle' && !targets.accessors.vehicle) throw noVehicle();
      kind = next;
      rebuild();
    },
    /**
     * Whether the controller listens to the mouse and keyboard and moves the camera. `false`
     * pauses it — no input, no `update` — without remaking it: velocity, footing, stride,
     * orientation and turn are kept, and `true` resumes exactly where it stopped.
     */
    get enabled() {
      return enabled;
    },
    set enabled(on: boolean) {
      if (on === enabled) return;
      enabled = on;
      current?.pause(!on);
      if (on) invalidate();
    },
    /** The point a pivot controller turns around. */
    get target(): Vector3 {
      return current?.target ?? standingTarget;
    },
    /** Whether the world's loop calls `update` ahead of each frame, before `world.beforeFrame`
     *  hooks. `false` hands the step to the page, which calls `update` from such a hook, as
     *  often and over whatever sub-steps it integrates; the world then never steps it. */
    autoUpdate: true,
    /** Character only: the body's velocity in metres per second, a copy; zero otherwise. */
    get velocity(): Vector3 {
      const v = (current as { velocity?: ArrayLike<number> } | null)?.velocity;
      return v ? new Vector3(v[0], v[1], v[2]) : new Vector3();
    },
    /** Character only: whether the feet are on a floor; `false` for any other controller. */
    get onGround(): boolean {
      return (current as { onGround?: boolean } | null)?.onGround === true;
    },
    /** Character only: the stride's phase in radians, a foot striking at 0 and π; 0 otherwise. */
    get stride(): number {
      return (current as { stride?: number } | null)?.stride ?? 0;
    },
    /** Integrates a steered controller over `delta` seconds; a pivot one re-reads its pose,
     *  and an orbit turns by `autoRotate`. A paused controller does nothing. */
    update(delta = 0) {
      if (!enabled) return;
      current?.update?.(delta);
    },
    /** The world's camera changed: the controller follows it. */
    follow: rebuild,
    /** Stops the controller and removes its listeners from the canvas. */
    dispose() {
      current?.dispose();
      current = null;
    },
  };
  // The settings are accessors of their own module; they join the handle as accessors, live.
  const kept = {
    ...Object.getOwnPropertyDescriptors(controlSettingAccessors(settings, setting)),
    ...Object.getOwnPropertyDescriptors(characterSettingAccessors(settings, setting)),
    ...Object.getOwnPropertyDescriptors(targets.accessors),
  };
  type Kept = ReturnType<typeof controlSettingAccessors> &
    ReturnType<typeof characterSettingAccessors> &
    typeof targets.accessors;
  return Object.defineProperties(handle, kept) as typeof handle & Kept;
}
