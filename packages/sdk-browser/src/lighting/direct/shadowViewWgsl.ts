import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'

/** The pass's eye in world metres, the origin a shadow read's located sample is shifted by
 *  (`vsmLocate`): set by each pass before its lights. */
export const SHADOW_VIEW_WGSL = wgslBlock(
  'SHADOW_VIEW_WGSL',
  [],
  `
var<private> shadowCamera:vec3f=vec3f(0.0);`,
)
