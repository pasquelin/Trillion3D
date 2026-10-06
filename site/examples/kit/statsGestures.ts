import type { Layout } from './statsLayout.ts'

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
  head.addEventListener('pointerdown', (event) => {
    press = { x: event.clientX, y: event.clientY, id: event.pointerId }
    dragging = false
  })
  head.addEventListener('pointermove', (event) => {
    if (!press || event.pointerId !== press.id) return
    const dx = event.clientX - press.x,
      dy = event.clientY - press.y
    if (!dragging && Math.hypot(dx, dy) < 6) return
    if (!dragging) {
      dragging = true
      head.setPointerCapture(event.pointerId)
      panel.toggleAttribute('data-dragging', true)
    }
    panel.style.translate = `${dx}px ${dy}px`
  })
  const settle = () => {
    press = null
    panel.style.removeProperty('translate')
    panel.removeAttribute('data-dragging')
  }
  const release = (event: PointerEvent) => {
    if (!press || event.pointerId !== press.id) return
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
    if (!press || event.pointerId !== press.id) return
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
    if (event.code !== 'Backquote' || event.repeat || event.ctrlKey || event.metaKey) return
    const target = event.target as HTMLElement | null
    if (target?.closest?.('input,textarea,[contenteditable]')) return
    toggle()
  }
  globalThis.addEventListener?.('keydown', onKey)
  return () => globalThis.removeEventListener?.('keydown', onKey)
}
