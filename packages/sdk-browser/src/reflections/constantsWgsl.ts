// The reflection's constant table (`constants.ts`) printed as the WGSL its shaders declare.
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { wgslF32 } from '../../../math/src/wgsl/number.ts'
import { REFLECTION_CONSTANTS } from './constants.ts'

/** The constants of the reflection's shaders (`REFLECTION_CONSTANTS`), as WGSL declares them. */
export const REFLECTION_CONSTANTS_WGSL = wgslBlock(
  'REFLECTION_CONSTANTS_WGSL',
  [],
  Object.entries(REFLECTION_CONSTANTS)
    .map(([name, value]) => `const ${name}:f32=${wgslF32(value)};`)
    .join('\n'),
)
