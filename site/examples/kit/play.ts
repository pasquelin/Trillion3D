import {
  createMenu,
  MENU_LABELS,
  type GameKey,
  type GameOption,
  type MenuActions,
  type MenuLabels,
  type MenuView,
} from './gameMenu.ts';

/**
 * A game's menu and pause, as every web game has them: the game runs only while the mouse is
 * locked to the canvas. Before the first play the start screen shows the title, the goal, a
 * Play button, the key sheet and the page's options; after Escape, a lost focus or a hidden tab,
 * the pause screen offers Resume, Restart and the keys. Paused, the world's controls are off and
 * `running` is false, which the page's frame reads to stop its simulation.
 *
 * THE LOCK. Play asks for it on the canvas of this document, and the game resumes only once it
 * is granted. A browser refuses it for about a second after the player pressed Escape, and on a
 * canvas that left its document: the menu stays, says to click again, and asks once more by
 * itself after that cooldown while the pointer is still over the page. Every refusal is caught,
 * from the promise `requestPointerLock()` returns or, in older browsers, from the
 * `pointerlockerror` event.
 */

/** The world as `play` uses it: the canvas it locks, the controls it switches, a redraw. */
export interface PlayWorld {
  canvas: {
    requestPointerLock?(): unknown;
    readonly isConnected?: boolean;
    readonly ownerDocument?: unknown;
  };
  controls: { enabled: boolean };
  invalidate(): void;
}

/** The game's menu, in the page's language, and what the page does on each change. */
export interface PlayOptions {
  /** The game's name, big on the start screen. Default `Play`. */
  title?: string;
  /** One line under it: what the player is to do. */
  goal?: string;
  /** The key sheet the Controls button opens. */
  keys?: GameKey[];
  /** Choices offered on the menu, reported through `onOption`. */
  options?: GameOption[];
  /** The menu's own words; English by default. */
  labels?: Partial<MenuLabels>;
  /** Called once, the first time the game runs, before `onResume`. */
  onStart?: () => void;
  /** Called when the game pauses: mute the sound, drop held keys. */
  onPause?: () => void;
  /** Called when the game resumes. */
  onResume?: () => void;
  /** Called by the pause screen's Restart, before the game resumes. */
  onRestart?: () => void;
  /** Called when the player picks `value` for the option `id`. */
  onOption?: (id: string, value: string) => void;
}

/** A paused or running game. */
export interface Game {
  /** Whether the game runs: the mouse is locked and the page visible. */
  readonly running: boolean;
  /** Whether it has run at least once. */
  readonly started: boolean;
}

/** The part of `document` `play` reads: the lock, the visibility, the events. */
export interface PlayDocument {
  readonly pointerLockElement: unknown;
  readonly hidden: boolean;
  readonly defaultView: { addEventListener(type: 'blur', listener: () => void): void } | null;
  addEventListener(type: string, listener: (event: { relatedTarget?: unknown }) => void): void;
}

/** What a browser waits after an Escape before it grants the lock again, and a margin. */
const COOLDOWN_MS = 1100;

/** The menu `play` draws by default, from the page's options. */
const drawnMenu = (options: PlayOptions) => (actions: MenuActions) =>
  createMenu(
    {
      title: options.title ?? MENU_LABELS.play,
      goal: options.goal ?? '',
      keys: options.keys ?? [],
      options: options.options ?? [],
      labels: { ...MENU_LABELS, ...options.labels },
    },
    actions,
  );

/**
 * Pauses `world` behind its menu until its canvas holds the mouse, and again whenever it lets go.
 * @param world - The world whose canvas is locked and whose controls are switched.
 * @param options - The menu's words, keys and choices, and the page's callbacks.
 * @param doc - The document; a test passes its own.
 * @param menu - Draws the menu; a test passes its own.
 */
export function play(
  world: PlayWorld,
  options: PlayOptions = {},
  doc: PlayDocument = document,
  menu: (actions: MenuActions) => MenuView = drawnMenu(options),
): Game {
  const again = options.labels?.again ?? MENU_LABELS.again;
  const { canvas } = world;
  let running = false,
    started = false,
    inside = true,
    retried = false,
    retry: ReturnType<typeof setTimeout> | undefined;
  const screen = () => (started ? 'pause' : 'start');
  const apply = (now: boolean) => {
    if (now === running) return;
    running = now;
    clearTimeout(retry);
    if (now && !started) {
      started = true;
      options.onStart?.();
    }
    view.show(now ? null : screen());
    // Off, the controls hear nothing: no walking, no looking, and they let go of the lock.
    if (world.controls.enabled !== now) world.controls.enabled = now;
    (now ? options.onResume : options.onPause)?.();
    world.invalidate();
  };
  const settle = () => apply(doc.pointerLockElement === canvas && !doc.hidden);
  const refused = (retryable: boolean) => {
    if (running) return;
    view.show(screen(), again);
    if (!retryable || retried || !inside) return;
    retried = true;
    retry = setTimeout(() => inside && lock(), COOLDOWN_MS);
  };
  function lock() {
    if (running) return;
    if (doc.pointerLockElement === canvas) return settle();
    // A canvas out of this document cannot hold its lock: asking would only be refused.
    if (canvas.isConnected === false || (canvas.ownerDocument && canvas.ownerDocument !== doc))
      return refused(false);
    try {
      const asked = canvas.requestPointerLock?.() as PromiseLike<void> | undefined;
      asked?.then?.(undefined, () => refused(true));
    } catch {
      refused(true);
    }
  }
  // A press on the menu: a fresh request, with its own one retry.
  const press = () => {
    clearTimeout(retry);
    retried = false;
    lock();
  };
  const view = menu({
    play: press,
    restart() {
      options.onRestart?.();
      press();
    },
    option: (id, value) => options.onOption?.(id, value),
  });
  view.show('start');
  world.controls.enabled = false;
  doc.addEventListener('pointerlockchange', settle);
  doc.addEventListener('pointerlockerror', () => refused(true));
  doc.addEventListener('visibilitychange', settle);
  // The pointer leaving the page (no element under it) cancels a retry that would pull it back.
  doc.addEventListener('pointerout', (event) => (inside = event.relatedTarget != null));
  doc.addEventListener('pointerover', () => (inside = true));
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
