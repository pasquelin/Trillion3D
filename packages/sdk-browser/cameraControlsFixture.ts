import type { ControlCamera, ControlVector } from './cameraControlTypes.ts';

/**
 * A camera and a surface with no DOM behind them, so the five controllers are proved on a
 * plain Node runtime: the fixture counts the listeners installed and removed, and replays
 * pointer, wheel and key events by hand. It is the fixture of `cameraControls*.test.ts`.
 */
function fixtureVector(x = 0, y = 0, z = 0): ControlVector {
  const v: ControlVector = {
    x,
    y,
    z,
    set(nx, ny, nz) {
      [v.x, v.y, v.z] = [nx, ny, nz];
      return v;
    },
    copy: (other) => v.set(other.x, other.y, other.z),
    clone: () => fixtureVector(v.x, v.y, v.z),
    add: (other) => v.set(v.x + other.x, v.y + other.y, v.z + other.z),
    sub: (other) => v.set(v.x - other.x, v.y - other.y, v.z - other.z),
    length: () => Math.hypot(v.x, v.y, v.z),
    setLength(length) {
      const scale = length / (v.length() || 1);
      return v.set(v.x * scale, v.y * scale, v.z * scale);
    },
    distanceTo: (other) => Math.hypot(v.x - other.x, v.y - other.y, v.z - other.z),
    fromArray: (array, offset = 0) =>
      v.set(Number(array[offset]), Number(array[offset + 1]), Number(array[offset + 2])),
  };
  return v;
}

export interface FixtureCamera extends ControlCamera {
  /** How many times the controller made the matrices current. */
  updates: number;
}

export function fixtureCamera(x = 0, y = 0, z = 10): FixtureCamera {
  const quaternion = {
    x: 0,
    y: 0,
    z: 0,
    w: 1,
    set(qx: number, qy: number, qz: number, qw: number) {
      Object.assign(quaternion, { x: qx, y: qy, z: qz, w: qw });
      return quaternion;
    },
  };
  return {
    position: fixtureVector(x, y, z),
    quaternion,
    fov: 50,
    updates: 0,
    updateMatrixWorld(this: FixtureCamera) {
      this.updates++;
    },
  };
}

type Recorded = { type: string; handler: EventListener };

/** An event target that remembers what is still listening to it. */
function recordingTarget() {
  const live: Recorded[] = [];
  const target = {
    addEventListener(type: string, handler: EventListener) {
      live.push({ type, handler });
    },
    removeEventListener(type: string, handler: EventListener) {
      const at = live.findIndex((entry) => entry.type === type && entry.handler === handler);
      if (at >= 0) live.splice(at, 1);
    },
  };
  const fire = (type: string, event: Record<string, unknown>) => {
    const payload = { preventDefault() {}, ...event } as unknown as Event;
    for (const entry of [...live]) if (entry.type === type) entry.handler(payload);
  };
  return { target, live, fire };
}

export function fixtureSurface(height = 400) {
  const view = recordingTarget(),
    document = recordingTarget(),
    window = recordingTarget();
  let locked: unknown = null;
  const element = {
    ...view.target,
    clientHeight: height,
    clientWidth: height,
    setPointerCapture() {},
    releasePointerCapture() {},
    requestPointerLock() {
      locked = element;
    },
    ownerDocument: {
      ...document.target,
      defaultView: window.target,
      get pointerLockElement() {
        return locked;
      },
      exitPointerLock() {
        locked = null;
      },
    },
  };
  return {
    element: element as unknown as HTMLElement,
    /** Listeners still installed across the surface, its document and its window. */
    listeners: () => view.live.length + document.live.length + window.live.length,
    fire: view.fire,
    key: document.fire,
    blur: window.fire,
    lock: () => element.requestPointerLock(),
  };
}

/** A press, a straight drag of `(dx, dy)` pixels in one move, and a release. */
export function fixtureDrag(
  surface: ReturnType<typeof fixtureSurface>,
  dx: number,
  dy: number,
  event: Record<string, unknown> = {},
) {
  const start = { pointerId: 1, button: 0, clientX: 100, clientY: 100, shiftKey: false, ...event };
  surface.fire('pointerdown', start);
  surface.fire('pointermove', {
    ...start,
    clientX: start.clientX + dx,
    clientY: start.clientY + dy,
    movementX: dx,
    movementY: dy,
  });
  surface.fire('pointerup', start);
}
