import { Vector3 } from '../../../../sdk-core/src/world/math/vector3.ts';
import { worldControls, type WorldControls } from './worldCamera.ts';
import type { Camera } from '../../../../sdk-core/src/world/camera/camera.ts';

/** A controller as the world drives it: a pivot one carries a `target`, a steered one integrates
 *  over a delta in `update`. */
type Controller = NonNullable<ReturnType<typeof worldControls>> & {
  target?: Vector3;
  update?: (delta?: number) => boolean;
};

/** The limits and speeds the handle keeps for its controller, at the controllers' own defaults. */
const DEFAULTS = {
  minDistance: 0,
  maxDistance: Infinity,
  minPolarAngle: 0,
  maxPolarAngle: Math.PI,
  minAzimuthAngle: -Infinity,
  maxAzimuthAngle: Infinity,
  movementSpeed: 1,
  lookSpeed: 0.002,
  rollSpeed: 0.4,
  rotateSpeed: 1,
  zoomSpeed: 1,
};
type Setting = keyof typeof DEFAULTS;

/**
 * `world.controls`: the controller driving the world's camera from the canvas, live. Changing
 * `kind` or `enabled` releases the one in place and makes the next; a gesture redraws.
 *
 * THE LIMITS AND SPEEDS BELONG TO THE HANDLE, not to the controller in place: a write is kept,
 * handed to the live controller when it has that setting, and handed again to every controller
 * `kind` makes later. A controller without that setting ignores it — the distances bound the
 * pivot controllers (orbit, trackball, pan-zoom), the angles the orbit alone; `movementSpeed`
 * drives flight and first person, `lookSpeed` first person, `rollSpeed` flight, `rotateSpeed`
 * and `zoomSpeed` the pivot controllers — so a page may set them before or after it picks its
 * controller.
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
    settings = { ...DEFAULTS };
  /** Hands the kept settings to the controller in place, where it has them. */
  const bound = () => {
    const live = current as Record<string, unknown> | null;
    if (!live) return;
    for (const name of Object.keys(settings) as Setting[])
      if (name in live) live[name] = settings[name];
  };
  const setting = (name: Setting, value: number) => {
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
  return {
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
    /** Closest a pivot controller brings the camera to `target`. */
    get minDistance() {
      return settings.minDistance;
    },
    set minDistance(value: number) {
      setting('minDistance', value);
    },
    /** Farthest a pivot controller takes the camera from `target`. */
    get maxDistance() {
      return settings.maxDistance;
    },
    set maxDistance(value: number) {
      setting('maxDistance', value);
    },
    /** Orbit only: smallest polar angle, in radians from straight up. */
    get minPolarAngle() {
      return settings.minPolarAngle;
    },
    set minPolarAngle(value: number) {
      setting('minPolarAngle', value);
    },
    /** Orbit only: largest polar angle; `Math.PI / 2` keeps the camera above the ground. */
    get maxPolarAngle() {
      return settings.maxPolarAngle;
    },
    set maxPolarAngle(value: number) {
      setting('maxPolarAngle', value);
    },
    /** Orbit only: start of the arc of azimuth allowed, in radians from +Z towards +X. */
    get minAzimuthAngle() {
      return settings.minAzimuthAngle;
    },
    set minAzimuthAngle(value: number) {
      setting('minAzimuthAngle', value);
    },
    /** Orbit only: end of that arc; it may be smaller than `minAzimuthAngle`. */
    get maxAzimuthAngle() {
      return settings.maxAzimuthAngle;
    },
    set maxAzimuthAngle(value: number) {
      setting('maxAzimuthAngle', value);
    },
    /** Flight and first person: world units per second at full stick; 1 by default. */
    get movementSpeed() {
      return settings.movementSpeed;
    },
    set movementSpeed(value: number) {
      setting('movementSpeed', value);
    },
    /** First person only: radians the view turns per pixel the pointer moves. */
    get lookSpeed() {
      return settings.lookSpeed;
    },
    set lookSpeed(value: number) {
      setting('lookSpeed', value);
    },
    /** Flight only: radians per second the keys pitch, yaw and roll. */
    get rollSpeed() {
      return settings.rollSpeed;
    },
    set rollSpeed(value: number) {
      setting('rollSpeed', value);
    },
    /** Orbit and trackball: how fast dragging turns; 1 by default. */
    get rotateSpeed() {
      return settings.rotateSpeed;
    },
    set rotateSpeed(value: number) {
      setting('rotateSpeed', value);
    },
    /** Pivot controllers: how fast the wheel and the pinch zoom; 1 by default. */
    get zoomSpeed() {
      return settings.zoomSpeed;
    },
    set zoomSpeed(value: number) {
      setting('zoomSpeed', value);
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
}
