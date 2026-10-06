/** What a frame asked of a world is drawn by, and what it waits for. */
type Parts<T> = {
  /** What the world lacks to draw now — its session opening, the families the frame draws with
   *  on their way (`../session/familyUse.ts`) —, nothing when it lacks nothing. */
  waits: () => Promise<unknown> | null | undefined
  /** The frame, `ahead` stepping first: its image, or null when the world has none to draw. */
  draw: (ahead?: () => void) => T | null
  /** The world was disposed: a frame that waited is drawn no more. */
  closed: () => boolean
  /** A frame drawn once it could throws past the page's call that asked it. */
  failed: (error: unknown) => void
}

/**
 * The frame a page asks of its world (`world.render`): drawn now when the world can draw it, else
 * once it can — its session opened, the families the frame draws with arrived, a session the
 * frame's own changes closed opened again —, once however many frames were asked meanwhile, with
 * the step the last one asked. A frame drawn meanwhile answers it. Until then a frame asked draws
 * nothing and steps nothing: null. A change asks no frame: the frame draws every change since the
 * last one, and nothing draws a page that never asks.
 */
export function askedFrame<T>({ waits, draw, closed, failed }: Parts<T>) {
  /** The frame waiting, with the step it takes once drawn; null when none waits. */
  let asked: { ahead?: () => void } | null = null
  const wait = (waiting: Promise<unknown>, ahead?: () => void) => {
    if (asked) return void (asked.ahead = ahead)
    const mine = (asked = { ahead })
    void waiting.then(() => {
      if (asked !== mine) return
      asked = null
      if (closed()) return
      try {
        frame(mine.ahead)
      } catch (error) {
        failed(error)
      }
    })
  }
  const frame = (ahead?: () => void): T | null => {
    const waiting = waits()
    if (waiting) return (wait(waiting, ahead), null)
    asked = null
    const image = draw(ahead)
    // What the frame applied closed the session (a reopen): drawn again once the next one opens.
    const reopening = image === null ? waits() : undefined
    if (reopening) wait(reopening, ahead)
    return image
  }
  return frame
}
