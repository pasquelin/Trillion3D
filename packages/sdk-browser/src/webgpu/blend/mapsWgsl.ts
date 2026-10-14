import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { BLEND_BINDINGS } from '../core/bindLayout.ts'
import { tileDeclarations } from '../tile/wgsl.ts'

/** The maps a blend fragment samples, in the blend group: the colour and data atlases and their
 *  sampler. The blend program's and the front stage's (`shader.ts`, `frontStageWgsl.ts`). */
export const BLEND_MAPS_WGSL = wgslBlock(
  'BLEND_MAPS_WGSL',
  [],
  `${tileDeclarations(BLEND_BINDINGS.color, 'color')}
@group(0) @binding(${BLEND_BINDINGS.sampler}) var mapsSampler:sampler;
${tileDeclarations(BLEND_BINDINGS.data, 'data')}`,
)
