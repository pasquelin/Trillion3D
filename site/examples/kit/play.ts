/**
 * A game's pause, as every web game has it: the game runs only while the mouse is locked to the
 * canvas. Before the first click, after Escape, when the window loses the focus or the tab is
 * hidden, the game is paused — a veil says so, the world's controls are off (no walking, no
 * looking) and `running` is false, which the page's frame reads to stop its simulation. A click
 * on the canvas asks for the lock; the game resumes only once the lock is granted.
 */

/** The world as `play` uses it: the canvas it locks, the controls it switches, a redraw. */
export interface PlayWorld {
  canvas: {
    addEventListener(type: 'click', listener: () => void): void;
    requestPointerLock?(): unknown;
  };
  controls: { enabled: boolean };
  invalidate(): void;
}

/** The words on the veil, in the page's language, and what the page does on each change. */
export interface PlayOptions {
  /** The first words, before the first click. Default `Click to play`. */
  title?: string;
  /** The words once the game has started. Default `Paused — click to continue`. */
  paused?: string;
  /** A line under them, the keys of the game. */
  keys?: string;
  /** Called when the game pauses: mute the sound, drop held keys. */
  onPause?: () => void;
  /** Called when the game resumes. */
  onResume?: () => void;
}

/** A paused or running game. */
export interface Game {
  /** Whether the game runs: the mouse is locked and the page visible. */
  readonly running: boolean;
  /** Whether it has run at least once. */
  readonly started: boolean;
}

/** The part of `document` `play` reads: the lock, the visibility, the events, a new element. */
export interface PlayDocument {
  readonly pointerLockElement: unknown;
  readonly hidden: boolean;
  readonly body: { append(node: unknown): void };
  readonly defaultView: { addEventListener(type: 'blur', listener: () => void): void } | null;
  addEventListener(type: 'pointerlockchange' | 'visibilitychange', listener: () => void): void;
  createElement(tag: 'div'): PlayElement;
}

/** The part of an element the veil writes. */
export interface PlayElement {
  textContent: string | null;
  style: { cssText: string };
  append(...nodes: unknown[]): void;
}

const VEIL =
  'position:fixed;inset:0;display:grid;place-content:center;gap:10px;text-align:center;' +
  'pointer-events:none;background:rgba(10,6,14,0.55);color:#fff;font:600 15px/1.3 system-ui,sans-serif;' +
  'text-shadow:0 2px 8px #000;z-index:10';

/**
 * Pauses `world` until its canvas holds the mouse, and pauses it again whenever it lets go.
 * @param world - The world whose canvas is locked and whose controls are switched.
 * @param options - The veil's words and the page's pause and resume.
 * @param doc - The document; a test passes its own.
 */
export function play(
  world: PlayWorld,
  options: PlayOptions = {},
  doc: PlayDocument = document,
): Game {
  const { title = 'Click to play', paused = 'Paused — click to continue', keys = '' } = options;
  const veil = doc.createElement('div'),
    heading = doc.createElement('div'),
    line = doc.createElement('div');
  veil.style.cssText = VEIL;
  heading.style.cssText = 'font-size:40px;color:#ffd27a';
  line.style.cssText = 'font-weight:400;max-width:36em';
  line.textContent = keys;
  veil.append(heading, line);
  doc.body.append(veil);
  let running = false,
    started = false;
  const apply = (now: boolean) => {
    if (now === running) return;
    running = now;
    started ||= now;
    heading.textContent = started ? paused : title;
    veil.style.cssText = now ? 'display:none' : VEIL;
    // Off, the controls hear nothing: no walking, no looking, and they let go of the lock.
    if (world.controls.enabled !== now) world.controls.enabled = now;
    (now ? options.onResume : options.onPause)?.();
    world.invalidate();
  };
  const settle = () => apply(doc.pointerLockElement === world.canvas && !doc.hidden);
  heading.textContent = title;
  world.controls.enabled = false;
  world.canvas.addEventListener('click', () => {
    if (running) return;
    if (doc.pointerLockElement === world.canvas) return settle();
    // A lock asked too soon after Escape is refused by the browser: the next click asks again.
    Promise.resolve(world.canvas.requestPointerLock?.()).catch(() => {});
  });
  doc.addEventListener('pointerlockchange', settle);
  doc.addEventListener('visibilitychange', settle);
  // A lost focus pauses at once, whether or not the browser has released the lock yet.
  doc.defaultView?.addEventListener('blur', () => apply(false));
  return {
    get running() {
      return running;
    },
    get started() {
      return started;
    },
  };
}
