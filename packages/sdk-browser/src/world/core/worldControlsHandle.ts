import { Vector3 } from '../../../../sdk-core/src/world/math/vector3.ts';
import { worldControls, type WorldControls } from './worldCamera.ts';
import type { Camera } from '../../../../sdk-core/src/world/camera/camera.ts';

/** A controller as the world drives it: a pivot one carries a `target`, a steered one integrates
 *  over a delta in `update`. */
type Controller = NonNullable<ReturnType<typeof worldControls>> & {
  target?: Vector3;
  update?: (delta?: number) => boolean;
};

/** The limits the handle keeps for its controller, at the orbit controller's own defaults. */
const UNBOUNDED = {
  minDistance: 0,
  maxDistance: Infinity,
  minPolarAngle: 0,
  maxPolarAngle: Math.PI,
  minAzimuthAngle: -Infinity,
  maxAzimuthAngle: Infinity,
};
type Limit = keyof typeof UNBOUNDED;

/**
 * `world.controls`: the controller driving the world's camera from the canvas, live. Changing
 * `kind` or `enabled` releases the one in place and makes the next; a gesture redraws.
 *
 * THE LIMITS BELONG TO THE HANDLE, not to the controller in place: a write is kept, handed to
 * the live controller when it has that limit, and handed again to every controller `kind`
 * makes later. A controller without that limit ignores it — the distances bound the pivot
 * controllers (orbit, trackball, pan-zoom), the angles the orbit alone, and flight and first
 * person neither — so a page may set them before or after it picks its controller.
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
    limits = { ...UNBOUNDED };
  /** Hands the kept limits to the controller in place, where it has them. */
  const bound = () => {
    const live = current as Record<string, unknown> | null;
    if (!live) return;
    for (const name of Object.keys(limits) as Limit[]) if (name in live) live[name] = limits[name];
  };
  const limit = (name: Limit, value: number) => {
    limits[name] = value;
    bound();
    // A pivot controller re-reads its pose under the new limit, and redraws if it moved.
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
      return limits.minDistance;
    },
    set minDistance(value: number) {
      limit('minDistance', value);
    },
    /** Farthest a pivot controller takes the camera from `target`. */
    get maxDistance() {
      return limits.maxDistance;
    },
    set maxDistance(value: number) {
      limit('maxDistance', value);
    },
    /** Orbit only: smallest polar angle, in radians from straight up. */
    get minPolarAngle() {
      return limits.minPolarAngle;
    },
    set minPolarAngle(value: number) {
      limit('minPolarAngle', value);
    },
    /** Orbit only: largest polar angle; `Math.PI / 2` keeps the camera above the ground. */
    get maxPolarAngle() {
      return limits.maxPolarAngle;
    },
    set maxPolarAngle(value: number) {
      limit('maxPolarAngle', value);
    },
    /** Orbit only: start of the arc of azimuth allowed, in radians from +Z towards +X. */
    get minAzimuthAngle() {
      return limits.minAzimuthAngle;
    },
    set minAzimuthAngle(value: number) {
      limit('minAzimuthAngle', value);
    },
    /** Orbit only: end of that arc; it may be smaller than `minAzimuthAngle`. */
    get maxAzimuthAngle() {
      return limits.maxAzimuthAngle;
    },
    set maxAzimuthAngle(value: number) {
      limit('maxAzimuthAngle', value);
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
