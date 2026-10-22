import type { Layout } from './layout.ts'

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
  let press: { x: number; y: number; id: number } | null = null,
    dragging = false
  /** Whether `event` is the pointer of the press in progress. */
  const owns = (event: PointerEvent) => press !== null && event.pointerId === press.id
  head.addEventListener('pointerdown', (event) => {
    // Only the primary button presses: a right or middle click starts nothing.
    if (event.button !== 0) return
    head.setPointerCapture?.(event.pointerId)
    press = { x: event.clientX, y: event.clientY, id: event.pointerId }
    dragging = false
    // The release can land anywhere: the window hears it when the header does not.
    globalThis.addEventListener?.('pointerup', stale)
    globalThis.addEventListener?.('pointercancel', stale)
  })
  head.addEventListener('pointermove', (event) => {
    if (!press || !owns(event)) return
    // A button released off the header never reached it: the press is stale.
    if (event.buttons === 0) {
      settle()
      dragging = false
      return
    }
    const dx = event.clientX - press.x,
      dy = event.clientY - press.y
    // A press becomes a drag past 6 pixels: its squared reach against 36, no root taken.
    if (!dragging && dx * dx + dy * dy < 36) return
    if (!dragging) {
      dragging = true
      panel.toggleAttribute('data-dragging', true)
    }
    panel.style.translate = `${dx}px ${dy}px`
  })
  const settle = () => {
    if (press) head.releasePointerCapture?.(press.id)
    press = null
    globalThis.removeEventListener?.('pointerup', stale)
    globalThis.removeEventListener?.('pointercancel', stale)
    panel.style.removeProperty('translate')
    panel.removeAttribute('data-dragging')
  }
  /** Drops a press whose end the header did not see; a drag in progress is left to its own release. */
  const stale = () => {
    if (press && !dragging) settle()
  }
  const release = (event: PointerEvent) => {
    if (!owns(event)) return
    const moved = dragging
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
    setTimeout(() => (dragging = false))
  }
  // A cancelled gesture (the system took the pointer) drops nothing: the panel stays where it was.
  const cancel = (event: PointerEvent) => {
    if (!owns(event)) return
    settle()
    dragging = false
  }
  head.addEventListener('pointerup', release)
  head.addEventListener('pointercancel', cancel)
  head.addEventListener('click', () => {
    if (dragging) dragging = false
    else toggle()
  })
  head.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    toggle()
  })
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
  return () => {
    globalThis.removeEventListener?.('keydown', onKey)
    settle()
  }
}
