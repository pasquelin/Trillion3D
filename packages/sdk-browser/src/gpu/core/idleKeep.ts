/** The images a view or a scene keeps a resource for after it stopped asking for it: a short pause (a toggle for an image) remakes nothing. */
export const IDLE_KEEP_IMAGES = 120

/** Whether something last used at image `since` has gone unused for `IDLE_KEEP_IMAGES` images at image `frame`. */
export const idleTooLong = (frame: number, since: number) => frame - since >= IDLE_KEEP_IMAGES

/** What a resource kept across a window of `IDLE_KEEP_IMAGES` images remembers: the most the images since `since` asked of it (`A`, folded by the owner's `merge`). */
export interface KeepingWindow<A> {
  most: A
  since: number
}

/**
 * Folds the ask of image `frame` (none where the resource is not asked this image) into `window`. Where the window ends at `frame` it returns the most it asked and the next window starts
 * from this image's ask (`rest` where there is none); otherwise it returns nothing.
 */
export function foldWindow<A>(
  window: KeepingWindow<A>,
  frame: number,
  ask: A | undefined,
  merge: (most: A, ask: A) => A,
  rest: A,
): A | undefined {
  if (ask !== undefined) window.most = merge(window.most, ask)
  if (!idleTooLong(frame, window.since)) return undefined
  const ended = window.most
  window.most = ask ?? rest
  window.since = frame
  return ended
}
