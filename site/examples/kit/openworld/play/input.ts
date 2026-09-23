/**
 * The keyboard and the mouse, read on the world's canvas: keys held by their physical code (so
 * W A S D sit under the same fingers on every layout), presses counted for the keys that act
 * once, and mouse motion summed while the pointer is locked. A click on the canvas locks it;
 * Escape gives it back, as the browser does.
 */
export type Input = {
  held(...codes: string[]): boolean;
  /** −1, 0 or 1 from a pair of key groups. */
  axis(positive: readonly string[], negative: readonly string[]): number;
  /** How many times a key went down since the start. */
  presses(code: string): number;
  /** Mouse motion since the last call, in pixels. */
  take(): { dx: number; dy: number };
  locked(): boolean;
  dispose(): void;
};

/** Keys whose browser default (scrolling the page, closing a find bar) the game takes over. */
const TAKEN = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

export function input(canvas: HTMLCanvasElement): Input {
  const down = new Set<string>();
  const counts = new Map<string, number>();
  let [dx, dy] = [0, 0];
  const locked = () => document.pointerLockElement === canvas;
  const listeners: [EventTarget, string, EventListener][] = [
    [
      window,
      'keydown',
      ((event: KeyboardEvent) => {
        if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement)
          return;
        if (TAKEN.has(event.code)) event.preventDefault();
        if (!event.repeat) counts.set(event.code, (counts.get(event.code) ?? 0) + 1);
        down.add(event.code);
      }) as EventListener,
    ],
    [window, 'keyup', ((event: KeyboardEvent) => void down.delete(event.code)) as EventListener],
    // A window that loses focus never hears its keys come back up.
    [window, 'blur', () => down.clear()],
    [canvas, 'click', () => locked() || canvas.requestPointerLock?.()],
    [
      document,
      'mousemove',
      ((event: MouseEvent) => {
        if (!locked()) return;
        dx += event.movementX;
        dy += event.movementY;
      }) as EventListener,
    ],
  ];
  for (const [target, type, listener] of listeners)
    target.addEventListener(type, listener, { passive: type !== 'keydown' });
  return {
    held: (...codes) => codes.some((code) => down.has(code)),
    axis: (positive, negative) =>
      (positive.some((code) => down.has(code)) ? 1 : 0) -
      (negative.some((code) => down.has(code)) ? 1 : 0),
    presses: (code) => counts.get(code) ?? 0,
    take() {
      const taken = { dx, dy };
      [dx, dy] = [0, 0];
      return taken;
    },
    locked,
    dispose() {
      for (const [target, type, listener] of listeners) target.removeEventListener(type, listener);
      if (locked()) document.exitPointerLock();
    },
  };
}
