/**
 * What the bloom's settings are read from, shared by the glow's own (`./bloomOptions.ts`), the
 * convolution's (`./bloomConvolutionOptions.ts`) and the dirt mask's (`./bloomDirtOptions.ts`):
 * a tint, and the check of a number against its least.
 */

/** A tint: one number for a grey, or red, green and blue. */
export type BloomTint = number | readonly [red: number, green: number, blue: number]

/** `value` when it is a finite number of at least `least`.
 *  @throws RangeError naming `label` and the value otherwise. */
export const finiteAtLeast = (value: unknown, least: number, label: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < least)
    throw new RangeError(`${label}:${String(value)}`)
  return value
}

/** A tint as its three channels, each finite and at least 0; `fallback` where `tint` is absent.
 *  @throws RangeError naming `label` when it is not three such numbers or one. */
export function resolveTint(
  tint: BloomTint | undefined,
  fallback: readonly [number, number, number],
  label: string,
): readonly [number, number, number] {
  if (tint === undefined) return fallback
  const channels = typeof tint === 'number' ? [tint, tint, tint] : [...tint]
  if (channels.length !== 3) throw new RangeError(label)
  const [red, green, blue] = channels.map((c) => finiteAtLeast(c, 0, label))
  return Object.freeze([red, green, blue] as const)
}
