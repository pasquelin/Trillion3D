import type { measureView } from './screenErrorMeasure.ts'

/** A held, error-free view must contain measured surfaces in both directions. */
export function screenErrorPass(
  measured: ReturnType<typeof measureView>,
  held: number,
  errors: readonly string[],
  pixelError: number,
) {
  return (
    held >= 0 &&
    errors.length === 0 &&
    measured.triangles > 0 &&
    measured.forward.points > 0 &&
    measured.reverse.points > 0 &&
    Number.isFinite(measured.forward.max) &&
    Number.isFinite(measured.reverse.max) &&
    Math.max(measured.forward.max, measured.reverse.max) <= pixelError + 0.1
  )
}
