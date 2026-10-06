/**
 * A CANVAS WHOSE IMAGE OUTLIVES ITS SESSION (#837). A world draws one canvas through every session
 * it opens: when one closes — its device lost, an option it cannot take in place — the image it
 * showed stays on screen until the next session has drawn its own, never a blank frame between.
 *
 * A presenter on a kept canvas (`presentation.ts`) therefore configures it only at its first
 * present, the configuration that would blank it followed in the same task by the new image; and
 * its withdrawal is left to the canvas's owner, who runs it once no session follows
 * (`releaseCanvasImage`) — a world disposed, a session that could not open, a scene emptied.
 */
const kept = new WeakSet<HTMLCanvasElement>()
/** The withdrawal of the last presenter that closed on a kept canvas, until a successor draws. */
const pending = new WeakMap<HTMLCanvasElement, () => void>()

/** From now on, `canvas` keeps its image when the session that drew it closes. */
export const keepCanvasImage = (canvas: HTMLCanvasElement) => void kept.add(canvas)

/** Whether `canvas` keeps its image across its sessions. */
export const canvasImageKept = (canvas: HTMLCanvasElement) => kept.has(canvas)

/** A presenter closes on `canvas`: `withdraw` runs now, or, on a kept canvas, when its owner
 *  releases the image. */
export function closeCanvasImage(canvas: HTMLCanvasElement, withdraw: () => void) {
  if (!kept.has(canvas)) return withdraw()
  pending.set(canvas, withdraw)
}

/** A successor draws on `canvas`: the image it replaces needs no withdrawal any more. */
export const canvasImageReplaced = (canvas: HTMLCanvasElement) => void pending.delete(canvas)

/** No session follows on `canvas` for now: the image left on it is withdrawn. `end` stops
 *  keeping it at all — its owner is gone. */
export function releaseCanvasImage(canvas: HTMLCanvasElement, end = false) {
  if (end) kept.delete(canvas)
  const withdraw = pending.get(canvas)
  pending.delete(canvas)
  withdraw?.()
}
