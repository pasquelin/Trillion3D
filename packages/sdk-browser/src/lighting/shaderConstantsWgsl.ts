import { wgslConst } from '../../../math/src/wgsl/decl.ts'
import { wgslF32 } from '../../../math/src/wgsl/number.ts'
import { ROUGHNESS_FLOOR as FLOOR } from './shaderConstants.ts'

/** The shading numbers shaders name (`shaderConstants.ts`), each the `f32` nearest its value,
 *  declared once: a shader lists the one it names. */

export const ROUGHNESS_FLOOR = wgslConst(
  'ROUGHNESS_FLOOR',
  [],
  `const ROUGHNESS_FLOOR:f32=${wgslF32(FLOOR)};`,
)
