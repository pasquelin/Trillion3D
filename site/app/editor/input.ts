import type { SceneActions } from './actions.ts';
import type { Session } from './session.ts';

/** How far a press may travel, in CSS pixels, and still be a click that selects: past it, the
 *  press was an orbit of the camera. */
const CLICK_SLOP = 4;
const MODES = { w: 'translate', e: 'rotate', r: 'scale' } as const;

/** True when a key was typed into a field, where it is text and never a shortcut. */
const typing = (target: EventTarget | null) =>
  target instanceof Element &&
  target.closest('input, textarea, select, [contenteditable="true"]') !== null;

/**
 * The editor's mouse and keyboard: a click on the canvas selects what is under it (a press on the
 * handles or one that turns the camera does not), W / E / R pick the handles' mode, Delete or
 * Backspace removes the selection, Ctrl or Cmd + Z undoes and + Shift + Z (or + Y) redoes.
 * Returns what takes every listener off.
 */
export function bindInput(session: Session, actions: SceneActions, canvas: HTMLCanvasElement) {
  let pressed: { x: number; y: number } | null = null;
  const press = (event: PointerEvent) => {
    // The handles hear the press first: a press on them is theirs, never a selection.
    pressed = session.gizmo.dragging ? null : { x: event.offsetX, y: event.offsetY };
  };
  const release = (event: PointerEvent) => {
    const from = pressed;
    pressed = null;
    if (!from || Math.hypot(event.offsetX - from.x, event.offsetY - from.y) > CLICK_SLOP) return;
    const hit = session.world.raycast({ x: event.offsetX, y: event.offsetY });
    session.select(hit?.object ?? null);
  };
  const key = (event: KeyboardEvent) => {
    // A shortcut mid-drag would edit under the drag, whose undo step began before it.
    if (typing(event.target) || session.gizmo.dragging) return;
    const name = event.key.toLowerCase();
    if (event.ctrlKey || event.metaKey) {
      const redo = (name === 'z' && event.shiftKey) || name === 'y';
      if (name !== 'z' && name !== 'y') return;
      event.preventDefault();
      if (redo) session.redo();
      else session.undo();
    } else if (name in MODES) session.setMode(MODES[name as keyof typeof MODES]);
    else if (name === 'delete' || name === 'backspace') {
      event.preventDefault();
      actions.remove();
    }
  };
  canvas.addEventListener('pointerdown', press);
  canvas.addEventListener('pointerup', release);
  window.addEventListener('keydown', key);
  return () => {
    canvas.removeEventListener('pointerdown', press);
    canvas.removeEventListener('pointerup', release);
    window.removeEventListener('keydown', key);
  };
}
