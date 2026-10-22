import { wgslFn, wgslStruct } from '../../../../math/src/wgsl/decl.ts'

/**
 * THE VIEW A PATCH IS JUDGED AND DICED FOR (`TessView`): what the factors, the fade and the dicing
 * read of it — the matrix taking the world to the clip space, the direction along which depth is
 * measured and the point where it is zero, the near plane, the pixels a unit subtends at depth one
 * per pixel an edge may span (`edgesPerUnit`) and whether the projection is perspective. The image's
 * own view is the visibility uniform's (`mainView`); a shadow map's is its projection's
 * (`../../lighting/shadows/vsm/tessellation/`): the kernels that cut and dice a patch are written
 * once over it.
 */
export const TESS_VIEW = wgslStruct(
  'TessView',
  [],
  'struct TessView{clip:mat4x4f,forward:vec3f,eye:vec3f,near:f32,edgesPerUnit:f32,perspective:bool,}',
)

/** The image's view, from the visibility uniform `uni` and the pass's uniform `tu`. */
export const MAIN_VIEW_WGSL = wgslFn(
  'mainView',
  [TESS_VIEW],
  `fn mainView()->TessView{
 return TessView(uni.viewProj,uni.forward,uni.eye,uni.near,tu.edgesPerUnit,uni.perspective>0.0);
}`,
)
