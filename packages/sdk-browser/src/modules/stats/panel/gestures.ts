import type { Layout } from './layout.ts'

/** The press in progress on the header and whether it became a drag. */
interface Drag {
  press: { x: number; y: number; id: number } | null
  dragging: boolean
}

/** Whether `event` is the pointer of the press in progress. */
const owns = (drag: Drag, event: PointerEvent) =>
  drag.press !== null && event.pointerId === drag.press.id

/** The two ends of a press: `settle` drops it and the header's marks, `stale` drops one whose end
 *  the header did not see (a drag in progress is left to its own release). */
function pressEnds(head: HTMLElement, panel: HTMLElement, drag: Drag) {
  const settle = () => {
    if (drag.press) head.releasePointerCapture?.(drag.press.id)
    drag.press = null
    globalThis.removeEventListener?.('pointerup', stale)
    globalThis.removeEventListener?.('pointercancel', stale)
    panel.style.removeProperty('translate')
    panel.removeAttribute('data-dragging')
  }
  const stale = () => {
    if (drag.press && !drag.dragging) settle()
  }
  return { settle, stale }
}

/** A primary-button press starts a press; the pointer is captured by the header. */
function bindPress(head: HTMLElement, drag: Drag, stale: () => void) {
  head.addEventListener('pointerdown', (event) => {
    // Only the primary button presses: a right or middle click starts nothing.
    if (event.button !== 0) return
    head.setPointerCapture?.(event.pointerId)
    drag.press = { x: event.clientX, y: event.clientY, id: event.pointerId }
    drag.dragging = false
    // The release can land anywhere: the window hears it when the header does not.
    globalThis.addEventListener?.('pointerup', stale)
    globalThis.addEventListener?.('pointercancel', stale)
  })
}

/** A press becomes a drag past a few pixels; the panel follows the pointer. */
function bindMove(head: HTMLElement, panel: HTMLElement, drag: Drag, settle: () => void) {
  head.addEventListener('pointermove', (event) => {
    const { press } = drag
    if (!press || !owns(drag, event)) return
    // A button released off the header never reached it: the press is stale.
    if (event.buttons === 0) {
      settle()
      drag.dragging = false
      return
    }
    const dx = event.clientX - press.x,
      dy = event.clientY - press.y
    // A press becomes a drag past 6 pixels: its squared reach against 36, no root taken.
    if (!drag.dragging && dx * dx + dy * dy < 36) return
    if (!drag.dragging) {
      drag.dragging = true
      panel.toggleAttribute('data-dragging', true)
    }
    panel.style.translate = `${dx}px ${dy}px`
  })
}

/** The end of a press: a drag drops the panel in the nearest corner; a cancelled gesture (the
 *  system took the pointer) drops nothing. */
function bindRelease(
  head: HTMLElement,
  panel: HTMLElement,
  area: HTMLElement,
  layout: Layout,
  drag: Drag,
  settle: () => void,
  save: () => void,
) {
  head.addEventListener('pointerup', (event) => {
    if (!owns(drag, event)) return
    const moved = drag.dragging
    settle()
    if (!moved) return
    const box = area.getBoundingClientRect()
    const right = event.clientX > box.left + box.width / 2,
      bottom = event.clientY > box.top + box.height / 2
    layout.corner = `${bottom ? 'bottom' : 'top'}-${right ? 'right' : 'left'}`
    panel.dataset.corner = layout.corner
    save()
    // The click that ends this drag, if the browser sends one, comes before this timer; one that
    // never comes must not swallow the viewer's next click.
    setTimeout(() => (drag.dragging = false))
  })
  head.addEventListener('pointercancel', (event) => {
    if (!owns(drag, event)) return
    settle()
    drag.dragging = false
  })
}

/** The folds of the header: a click, Enter or Space; binds no global listener. */
function bindFold(head: HTMLElement, drag: Drag, toggle: () => void) {
  head.addEventListener('click', () => {
    if (drag.dragging) drag.dragging = false
    else toggle()
  })
  head.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    toggle()
  })
}

/** The key left of 1 folds the panel, unless the viewer is typing. Returns what unbinds it. */
function bindBackquote(toggle: () => void) {
  const onKey = (event: KeyboardEvent) => {
    if (
      event.code !== 'Backquote' ||
      event.repeat ||
      event.ctrlKey ||
      event.metaKey ||
      event.defaultPrevented
    )
      return
    const target = event.target as HTMLElement | null
    if (target?.isContentEditable || target?.closest?.('input,textarea,select,[contenteditable]'))
      return
    event.preventDefault()
    toggle()
  }
  globalThis.addEventListener?.('keydown', onKey)
  return () => globalThis.removeEventListener?.('keydown', onKey)
}

/**
 * The gestures of the panel's header: a click, Enter or Space folds it (`toggle`); a drag of
 * more than a few pixels moves it to the nearest corner of `area`, `layout.corner`, then `save`;
 * the key left of 1 folds it too. Returns what unbinds the key.
 */
export function bindGestures(
  head: HTMLElement,
  panel: HTMLElement,
  area: HTMLElement,
  layout: Layout,
  toggle: () => void,
  save: () => void,
) {
  const drag: Drag = { press: null, dragging: false }
  const { settle, stale } = pressEnds(head, panel, drag)
  bindPress(head, drag, stale)
  bindMove(head, panel, drag, settle)
  bindRelease(head, panel, area, layout, drag, settle, save)
  bindFold(head, drag, toggle)
  const unbindKey = bindBackquote(toggle)
  return () => {
    unbindKey()
    settle()
  }
}
