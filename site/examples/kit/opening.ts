/**
 * The camera's opening glide, the one move most examples start on: the camera flies in on its
 * own, then gives itself to the viewer at the first press or wheel on the canvas. And the curves
 * such moves ease on.
 */

const unit = (t: number) => Math.min(1, Math.max(0, t));

/** The curves a move eases on: `t` from 0 to 1 (clamped) gives how far along it is. */
export const ease = {
  /** Slow at both ends, the smoothstep. */
  smooth: (t: number) => {
    const x = unit(t);
    return x * x * (3 - 2 * x);
  },
  /** Slow at both ends, more sharply: a cubic in, then out. */
  inOut: (t: number) => {
    const x = unit(t);
    return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
  },
  /** Fast at first, landing softly: a cubic out. */
  out: (t: number) => 1 - (1 - unit(t)) ** 3,
};

/** The world as far as the opening goes: its canvas, its loop and its camera controls. */
export interface OpeningWorld {
  canvas: Pick<HTMLElement, 'addEventListener'>;
  onFrame(hook: (frame: { delta: number }) => void): unknown;
  invalidate(): void;
  controls?: { update(): unknown } | null;
}

/** A glide under way, or over. */
export interface Opening {
  /** Whether the camera still flies on its own. */
  readonly gliding: boolean;
  /** Flies the glide again from its start: a "fly again" button. */
  restart(): void;
  /** Ends the glide where it is. */
  stop(): void;
}

/**
 * Poses the camera every frame with `pose(time)`, `time` the seconds the glide has run (a frame
 * counts 50 ms at most, so a hidden tab does not skip the flight), then updates the controls and
 * asks for a frame. It ends when `pose` answers `false` — it has landed — or at the viewer's
 * first press or wheel on the canvas. `pose(0)` runs at once, so the first frame is the glide's.
 */
export function opening(world: OpeningWorld, pose: (time: number) => boolean | void): Opening {
  let time = 0,
    gliding = true;
  const place = () => {
    if (pose(time) === false) gliding = false;
    world.controls?.update();
    world.invalidate();
  };
  const stop = () => void (gliding = false);
  for (const type of ['pointerdown', 'wheel'])
    world.canvas.addEventListener(type, stop, { passive: true });
  world.onFrame(({ delta }) => {
    if (!gliding) return;
    time += Math.min(delta, 0.05);
    place();
  });
  place();
  return {
    get gliding() {
      return gliding;
    },
    restart() {
      time = 0;
      gliding = true;
      place();
    },
    stop,
  };
}

/** A point the camera stands at or turns around. */
interface Point {
  x: number;
  y: number;
  z: number;
}

/** A point the page can move. */
type Movable = Point & { set(x: number, y: number, z: number): unknown };

/** The world as far as circling goes: an opening's, with the camera and the point it orbits. */
export interface CirclingWorld extends OpeningWorld {
  camera: { position: Movable; lookAt?(target: Point): unknown };
  controls: { update(): unknown; target: Movable };
}

/**
 * An opening that circles the camera round the controls' target, at its height, `speed` radians
 * a second (clockwise seen from above when positive), from wherever it stands when it starts or
 * `restart()`s. It faces the target itself, for a world whose controls do not aim the camera.
 */
export function circling(world: CirclingWorld, speed: number): Opening {
  const { position } = world.camera,
    { target } = world.controls;
  let [dx, dz] = [0, 0];
  return opening(world, (time) => {
    if (time === 0) [dx, dz] = [position.x - target.x, position.z - target.z];
    const [cos, sin] = [Math.cos(time * speed), Math.sin(time * speed)];
    position.set(target.x + dx * cos + dz * sin, position.y, target.z + dz * cos - dx * sin);
    world.camera.lookAt?.(target);
  });
}

/** Where the camera stands and the point it looks at, as `[x, y, z]`. */
export interface View {
  position: readonly number[];
  target: readonly number[];
}

/**
 * The camera's flights: `flyTo(view, seconds, wait)` flies it from wherever it stands to `view`
 * after `wait` seconds, eased by `curve`, until the viewer's press or wheel ends the flight where
 * it is. A flight asked for during another starts from where that one had got to.
 */
export function flights(world: CirclingWorld, curve = ease.inOut) {
  const { position } = world.camera,
    { target } = world.controls;
  let from: number[] = [],
    to: number[] = [],
    seconds = 1,
    delay = 0;
  const glide = opening(world, (time) => {
    if (!to.length) return false;
    const e = curve((time - delay) / seconds),
      [x, y, z, tx, ty, tz] = from.map((value, i) => value + (to[i] - value) * e);
    position.set(x, y, z);
    target.set(tx, ty, tz);
    return time < delay + seconds;
  });
  return (view: View, length: number, wait = 0) => {
    from = [position.x, position.y, position.z, target.x, target.y, target.z];
    to = [...view.position, ...view.target];
    [seconds, delay] = [length, wait];
    glide.restart();
  };
}
