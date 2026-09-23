import { Vector3 } from '../../../../sdk-core/src/world/math/vector3.ts';
import { worldControls, type WorldControls } from './worldCamera.ts';
import type { Camera } from '../../../../sdk-core/src/world/camera/camera.ts';
import { CONTROL_SETTINGS, type ControlSetting, type Controller } from './worldControlsSettings.ts';
import { controlSettingAccessors } from './worldControlsAccessors.ts';

/**
 * `world.controls`: the controller driving the world's camera from the canvas, live. Changing
 * `kind` or `enabled` releases the one in place and makes the next; a gesture redraws.
 *
 * THE LIMITS AND SPEEDS BELONG TO THE HANDLE, not to the controller in place: a write is kept,
 * handed to the live controller when it has that setting, and handed again to every controller
 * `kind` makes later. A controller without that setting ignores it — the distances bound the
 * pivot controllers (orbit, trackball, pan-zoom), the angles the orbit alone; `movementSpeed`
 * drives flight and first person, `lookSpeed`, `minPitch` and `maxPitch` first person, the
 * turn speeds, the stick inputs, `inputResponse`, `autoForward` and `pointerLook` flight, `rotateSpeed` and
 * `zoomSpeed` the pivot controllers — so a page may set them before or after it picks its
 * controller. A cruising flight moves on every frame, so the handle asks for the first one; a
 * disabled controller, or any other kind, leaves the scene still.
 */
export function worldControlsHandle(
  initial: WorldControls,
  camera: () => Camera,
  surface: HTMLElement,
  invalidate: () => void,
) {
  let kind = initial,
    enabled = true,
    current: Controller | null = null;
  const standingTarget = new Vector3(),
    settings = { ...CONTROL_SETTINGS };
  /** Hands the kept settings to the controller in place, where it has them; a controller that
   *  now cruises is sent its first frame, the ones after follow from its own `change`. */
  const bound = () => {
    const live = current as Record<string, unknown> | null;
    if (!live) return;
    for (const name of Object.keys(settings) as ControlSetting[])
      if (name in live) live[name] = settings[name];
    if (live.autoForward === true) invalidate();
  };
  const setting = <K extends ControlSetting>(name: K, value: (typeof CONTROL_SETTINGS)[K]) => {
    settings[name] = value;
    bound();
    // A pivot controller re-reads its pose under the new setting, and redraws if it moved.
    if (current?.target) current.update?.();
  };
  const rebuild = () => {
    standingTarget.copy(current?.target ?? standingTarget);
    current?.dispose();
    current = enabled ? (worldControls(kind, camera(), surface) as Controller | null) : null;
    bound();
    if (current?.target) {
      current.target.copy(standingTarget);
      current.update?.();
    }
    current?.addEventListener('change', invalidate);
  };
  rebuild();
  const handle = {
    /** Which controller steers the camera; set another name to switch. */
    get kind() {
      return kind;
    },
    set kind(next: WorldControls) {
      kind = next;
      rebuild();
    },
    /** Whether the controller listens to the mouse and keyboard. */
    get enabled() {
      return enabled;
    },
    set enabled(on: boolean) {
      enabled = on;
      rebuild();
    },
    /** The point a pivot controller turns around. */
    get target(): Vector3 {
      return current?.target ?? standingTarget;
    },
    /** Integrates a steered controller over `delta` seconds; a pivot one re-reads its pose. */
    update(delta = 0) {
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
  const kept = controlSettingAccessors(settings, setting);
  return Object.defineProperties(handle, Object.getOwnPropertyDescriptors(kept)) as typeof handle &
    typeof kept;
}
