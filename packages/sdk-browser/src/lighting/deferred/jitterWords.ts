/** Raster jitter in pixels, rows down, followed by a reserved word and the temporal
 * sampling phase. The phase advances only on accumulated images, including quiet ones. */
export function shadowJitterWords<T extends { [word: number]: number } = number[]>(
  jitter: ArrayLike<number> | null,
  into: T = [0, 0, 0, 0] as unknown as T,
  at = 0,
  phase = 0,
): T {
  into[at] = jitter ? jitter[0] : 0
  into[at + 1] = jitter ? -jitter[1] : 0
  into[at + 2] = 0
  into[at + 3] = phase
  return into
}
