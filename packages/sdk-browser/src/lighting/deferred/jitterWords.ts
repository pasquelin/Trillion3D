/** The view's `jitter` words (`VIEW_WGSL`): the raster jitter in pixels, rows down, the word the
 * temporal pass reads as its image-moves flag (0 in the deferred view, which never moves it) and
 * the temporal sampling phase. The phase advances only on accumulated images, including quiet ones. */
export function viewJitterWords<T extends { [word: number]: number } = number[]>(
  jitter: ArrayLike<number> | null,
  into: T = [0, 0, 0, 0] as unknown as T,
  at = 0,
  phase = 0,
): T {
  into[at] = jitter ? jitter[0] : 0
  into[at + 1] = jitter ? -jitter[1] : 0
  into[at + 2] = 0 // the moving flag, set by the temporal pass alone
  into[at + 3] = phase
  return into
}
