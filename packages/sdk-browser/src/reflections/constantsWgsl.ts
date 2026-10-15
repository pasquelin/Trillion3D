// The reflection's constant table (`constants.ts`) printed as the WGSL its shaders declare.
import { wgslBlock, wgslFn } from '../../../math/src/wgsl/decl.ts'
import { wgslF32 } from '../../../math/src/wgsl/number.ts'
import { wgslConsts } from '../../../math/src/wgsl/consts.ts'
import { REFLECTION_CONSTANTS, REFLECTION_COUNTS } from './constants.ts'

/** The constants of the reflection's shaders (`REFLECTION_CONSTANTS`, `REFLECTION_COUNTS`), as WGSL
 *  declares them. */
export const REFLECTION_CONSTANTS_WGSL = wgslBlock(
  'REFLECTION_CONSTANTS_WGSL',
  [],
  Object.entries(REFLECTION_CONSTANTS)
    .map(([name, value]) => `const ${name}:f32=${wgslF32(value)};`)
    .join('\n') +
    '\n' +
    wgslConsts(REFLECTION_COUNTS),
)

/** The `k`-th pixel of grid texel `g`'s block (`REFLECTION_TRACE_BLOCK`², `grids.ts`), row by row: the
 *  one order of a block's pixels, the trace's turns and every walk of a block's pixels alike. */
export const REFLECTION_BLOCK_PIXEL_WGSL = wgslFn(
  'reflectionBlockPixel',
  [REFLECTION_CONSTANTS_WGSL],
  'fn reflectionBlockPixel(g:vec2u,k:u32)->vec2u{return g*REFLECTION_TRACE_BLOCK+vec2u(k%REFLECTION_TRACE_BLOCK,k/REFLECTION_TRACE_BLOCK);}',
)
