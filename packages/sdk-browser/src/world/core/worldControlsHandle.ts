import { Vector3 } from '../../../../sdk-core/src/world/math/vector3.ts';
import { worldControls, type WorldControls } from './worldCamera.ts';
import type { Camera } from '../../../../sdk-core/src/world/camera/camera.ts';
import { CONTROL_SETTINGS, type ControlSetting, type Controller } from './worldControlsSettings.ts';
import { controlSettingAccessors } from './worldControlsAccessors.ts';
import { characterSettingAccessors } from './worldCharacterAccessors.ts';
import { meshCollision } from '../../../../sdk-core/src/collision/meshTriangles.ts';
import type { TriangleCollision } from '../../../../sdk-core/src/collision/characterCollision.ts';
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';

/**
 * `world.controls`: the controller driving the world's camera from the canvas, live. Changing
 * `kind` or `enabled` releases the one in place and makes the next; a gesture redraws.
 *
 * THE LIMITS AND SPEEDS BELONG TO THE HANDLE, not to the controller in place: a write is kept,
 * handed to the live controller when it has that setting, and handed again to every controller
 * `kind` makes later. A controller without that setting ignores it — the distances bound the
 * pivot controllers (orbit, trackball, pan-zoom), the angles the orbit alone; `movementSpeed`
 * drives flight and first person, `lookSpeed`, `minPitch` and `maxPitch` first person and the
 * character, the turn speeds, the stick inputs, `inputResponse`, `autoForward` and
 * `pointerLook` flight, `rotateSpeed` and `zoomSpeed` the pivot controllers, the body, speeds,
 * jump and hooks the character — so a page may set them before or after it picks its
 * controller. The character's `colliders` are kept the same way: the triangle tree is built
 * once when they are set, handed to every character `kind` makes, and rebuilt only on
 * `rebuildColliders()`. A cruising flight moves on every frame, so the handle asks for the
 * first one; a disabled controller, or any other kind, leaves the scene still.
 */
export function worldControlsHandle(
  initial: WorldControls,
  camera: () => Camera,
  surface: HTMLElement,
  invalidate: () => void,
) {
  let kind = initial,
    enabled = true,
    current: Controller | null = null,
    colliders: Object3D | readonly Object3D[] | null = null,
    collision: TriangleCollision | null = null;
  const standingTarget = new Vector3(),
    settings = { ...CONTROL_SETTINGS };
  /** Whether the controller in place moves on its own — cruising, or a stick input held — and
   *  so is sent its first frame; the ones after follow from its own `change`. */
  const wake = (live: Record<string, unknown>) => {
    if (live.autoForward === true || live.pitchInput || live.yawInput || live.rollInput)
      invalidate();
  };
  /** Hands every kept setting to the controller in place, where it has them. */
  const bound = () => {
    const live = current as Record<string, unknown> | null;
    if (!live) return;
    for (const name of Object.keys(settings) as ControlSetting[])
      if (name in live) live[name] = settings[name];
    if ('collision' in live && live.collision !== collision) live.collision = collision;
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
    /** Whether the world's loop calls `update` ahead of each frame, before `world.beforeFrame`
     *  hooks. `false` hands the step to the page, which calls `update` from such a hook, as
     *  often and over whatever sub-steps it integrates; the world then never steps it. */
    autoUpdate: true,
    /**
     * Character only: the meshes the body collides with — one object or a list, their
     * descendants included — or `null`. Setting them builds a static triangle tree from their
     * world-space triangles as they stand now: one pass over the triangles and an
     * `O(T log T)` build, about 52 bytes kept per triangle. Compiled models are not read yet:
     * give a simple mesh stand-in for them.
     */
    get colliders() {
      return colliders;
    },
    set colliders(next: Object3D | readonly Object3D[] | null) {
      colliders = next;
      handle.rebuildColliders();
    },
    /** Character only: builds the collision tree again, after the colliders moved or changed. */
    rebuildColliders() {
      collision = colliders ? meshCollision(colliders) : null;
      bound();
      invalidate();
    },
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
  const kept = {
    ...Object.getOwnPropertyDescriptors(controlSettingAccessors(settings, setting)),
    ...Object.getOwnPropertyDescriptors(characterSettingAccessors(settings, setting)),
  };
  type Kept = ReturnType<typeof controlSettingAccessors> &
    ReturnType<typeof characterSettingAccessors>;
  return Object.defineProperties(handle, kept) as typeof handle & Kept;
}
