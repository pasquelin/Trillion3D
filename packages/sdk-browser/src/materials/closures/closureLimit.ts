import { CLOSURE_RULES } from '../../../../sdk-core/src/contracts/closureOptions.ts'
import { MAX_CLOSURES } from '../../../../sdk-core/src/world/material/graph/closures.ts'
import { clamp } from '../../../../math/src/scalar/reals.ts'

/** The project's closures per pixel as a compile reads it: the setting held between one and the format's most, a value that is no number
 *  being the setting's default (clamped 1 to the format's most). */
export const clampClosureLimit = (value: number | undefined) =>
  clamp(
    Number.isFinite(value) ? Math.trunc(value!) : CLOSURE_RULES.closuresPerPixel.default,
    1,
    MAX_CLOSURES,
  )

/** The closures per pixel a runtime's programs are compiled for: what its frame last applied (`followClosureLimit`), the setting's default before
 *  the first frame. Read from what a caller already receives (the layers `rt.vis` is, or the runtime itself), never held by the module. */
export const limitOf = (held: { readonly closures?: { readonly applied?: number } }) =>
  clampClosureLimit(held.closures?.applied)
