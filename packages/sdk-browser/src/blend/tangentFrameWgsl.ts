import { COTANGENT_FRAME_WGSL } from '../geometry/cluster/cotangentFrameWgsl.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { unitOrZero } from '../../../math/src/wgsl/inverseTranspose.ts'

/** The frame of the tangents a blend's page stores, as its vertex stage turned them to the world
 *  (`vertexWgsl.ts`, `FLAG_HAS_TANGENT`): the one tangent source of the fragment, which its normal
 *  map (`shaderSurface.ts`) and its lobes (`physicalWgsl.ts`) bend in (`physicalValues`). It lives
 *  in a module of its own: the surface reads the request, which reads the lobes, which read the frame. */
export const BLEND_TANGENT_FRAME_WGSL = wgslBlock(
  'BLEND_TANGENT_FRAME_WGSL',
  [COTANGENT_FRAME_WGSL, unitOrZero],
  `fn blendTangentFrame(in:VSOut)->CotangentFrame{return CotangentFrame(unitOrZero(in.tangent.xyz),unitOrZero(in.bitangent.xyz));}`,
)
