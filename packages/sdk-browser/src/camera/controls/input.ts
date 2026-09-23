import type { ControlBase } from './base.ts';

/**
 * The input every camera controller reads: pointers, wheel, keys. Written once here so the
 * five controllers differ by what they DO with a drag, never by how they receive it.
 *
 * POINTERS. `pointerdown` captures the pointer on the surface, so a drag that leaves the
 * canvas keeps arriving; `pointerup` and `pointercancel` release it. A locked pointer is never
 * captured (it has no position to leave the canvas with), and a capture the browser refuses —
 * a pointer already gone, a lock taken meanwhile — is skipped, never thrown. One pointer reports a
 * drag with the button that started it; two report a pinch — the ratio of the distance
 * between them and the pixel motion of their midpoint — which is how a touch surface zooms
 * and pans at once. Nothing is polled: a controller that receives no event does no work.
 *
 * TOUCH. A touch screen scrolls the page on one finger and zooms it on two unless the surface
 * claims the gesture with `touch-action: none`; the browser otherwise cancels the pointer
 * stream mid-drag and no pinch ever reaches a controller. `dispose()` puts the value the host
 * had written back, and gives up every capture still held, so the page is left as it was.
 */
export interface DragHandlers {
  /** One pointer moved by `(dx, dy)` pixels, `button` being the one that started the drag. */
  drag(dx: number, dy: number, button: number, event: PointerEvent): void;
  /** Two pointers: `ratio` above one means they moved apart; `(dx, dy)` is their midpoint. */
  pinch?(ratio: number, dx: number, dy: number): void;
  down?(event: PointerEvent): void;
  up?(): void;
}

type Point = { x: number; y: number };

/** Captures or releases `pointerId` on `surface` when the browser allows it, silently otherwise. */
function capture(surface: HTMLElement, pointerId: number, on: boolean) {
  if (on && surface.ownerDocument?.pointerLockElement) return;
  try {
    if (on) surface.setPointerCapture?.(pointerId);
    else surface.releasePointerCapture?.(pointerId);
  } catch {
    // `InvalidStateError` or `NotFoundError`: the pointer is locked or no longer active.
  }
}

export function trackPointers(surface: HTMLElement, base: ControlBase, handlers: DragHandlers) {
  const pointers = new Map<number, Point>();
  let button = 0,
    span = 0;
  const midpoint = (): Point => {
    let x = 0,
      y = 0;
    for (const point of pointers.values()) {
      x += point.x;
      y += point.y;
    }
    return { x: x / pointers.size, y: y / pointers.size };
  };
  const distance = () => {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  const scrolling = surface.style.touchAction;
  surface.style.touchAction = 'none';
  base.undo(() => {
    surface.style.touchAction = scrolling;
    for (const pointerId of pointers.keys()) capture(surface, pointerId, false);
    pointers.clear();
  });
  base.listen<PointerEvent>(surface, 'pointerdown', (event) => {
    if (pointers.size === 0) button = event.button;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2) span = distance();
    capture(surface, event.pointerId, true);
    event.preventDefault();
    handlers.down?.(event);
  });
  base.listen<PointerEvent>(surface, 'pointermove', (event) => {
    const previous = pointers.get(event.pointerId);
    if (!previous) return;
    const before = pointers.size > 1 ? midpoint() : previous;
    const beforeX = before.x,
      beforeY = before.y;
    previous.x = event.clientX;
    previous.y = event.clientY;
    const dx = event.clientX - beforeX,
      dy = event.clientY - beforeY;
    // A move that moved nothing is not a gesture: it must not wake a still scene.
    if (pointers.size === 1 && (dx || dy)) handlers.drag(dx, dy, button, event);
    else if (pointers.size === 2) {
      const after = midpoint(),
        next = distance();
      handlers.pinch?.(span > 0 ? next / span : 1, after.x - beforeX, after.y - beforeY);
      span = next;
    }
  });
  const release = (event: PointerEvent) => {
    if (!pointers.delete(event.pointerId)) return;
    capture(surface, event.pointerId, false);
    if (pointers.size < 2) span = 0;
    if (pointers.size === 0) handlers.up?.();
  };
  base.listen<PointerEvent>(surface, 'pointerup', release);
  base.listen<PointerEvent>(surface, 'pointercancel', release);
  // A secondary-button drag is a pan, so the menu the platform would open must not.
  base.listen<Event>(surface, 'contextmenu', (event) => event.preventDefault());
  return pointers;
}

/**
 * Wheel notches, sign kept: one line or one page counts as much as the pixel deltas a
 * trackpad sends, so a mouse and a trackpad zoom by comparable steps.
 */
export function trackWheel(
  surface: HTMLElement,
  base: ControlBase,
  onSteps: (steps: number) => void,
) {
  base.listen<WheelEvent>(
    surface,
    'wheel',
    (event) => {
      event.preventDefault();
      const steps = event.deltaMode === 0 ? event.deltaY / 100 : event.deltaY;
      if (steps) onSteps(steps);
    },
    { passive: false },
  );
}

/**
 * The keys held down, by `KeyboardEvent.code` so a layout cannot change the mapping. The
 * listeners sit on the document that owns the surface: a key pressed while the canvas has no
 * focus still steers, as a viewer expects, and `dispose()` takes them back off.
 */
export function trackKeys(surface: HTMLElement, base: ControlBase, onChange: () => void) {
  const pressed = new Set<string>();
  const document = surface.ownerDocument;
  base.listen<KeyboardEvent>(document, 'keydown', (event) => {
    if (event.metaKey || event.ctrlKey || pressed.has(event.code)) return;
    pressed.add(event.code);
    onChange();
  });
  base.listen<KeyboardEvent>(document, 'keyup', (event) => {
    if (pressed.delete(event.code)) onChange();
  });
  // A window that loses focus never sends the `keyup`: the key would stay held forever.
  base.listen<Event>(document.defaultView ?? document, 'blur', () => {
    if (pressed.size) {
      pressed.clear();
      onChange();
    }
  });
  return pressed;
}

/** The two key groups of one axis: what drives it positive, what drives it negative. */
export type KeyAxis = [string[], string[]];

/** `+1` when the first group is held, `-1` for the second, `0` for both or neither. */
export function axisOf(pressed: Set<string>, positive: string[], negative: string[]) {
  const up = positive.some((code) => pressed.has(code)) ? 1 : 0;
  const down = negative.some((code) => pressed.has(code)) ? 1 : 0;
  return up - down;
}
