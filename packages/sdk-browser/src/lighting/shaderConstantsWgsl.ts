import { wgslConst } from '../../../math/src/wgsl/decl.ts'
import { wgslF32 } from '../../../math/src/wgsl/number.ts'
import {
  MIRROR_TRANSITION_END as TRANSITION_END,
  ROUGHNESS_FLOOR as FLOOR,
} from './shaderConstants.ts'

/** The shading numbers shaders name (`shaderConstants.ts`), each the `f32` nearest its value,
 *  declared once: a shader lists the one it names. */

export const ROUGHNESS_FLOOR = wgslConst(
  'ROUGHNESS_FLOOR',
  [],
  `const ROUGHNESS_FLOOR:f32=${wgslF32(FLOOR)};`,
)

export const MIRROR_TRANSITION_END = wgslConst(
  'MIRROR_TRANSITION_END',
  [],
  `const MIRROR_TRANSITION_END:f32=${wgslF32(TRANSITION_END)};`,
)
