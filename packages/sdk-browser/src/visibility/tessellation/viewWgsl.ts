import { wgslBlock, wgslFn, wgslStruct } from '../../../../math/src/wgsl/decl.ts'
import { worldMatrix3 } from '../../../../math/src/wgsl/matrix.ts'
import { edgeFactors, quarterRateDepth } from './patchWgsl.ts'

/**
 * THE VIEW A PATCH IS JUDGED AND DICED FOR (`TessView`): what the factors, the fade and the dicing
 * read of it — the matrix taking the world to the clip space, the direction along which depth is
 * measured and the point where it is zero, the near plane, the pixels a unit subtends at depth one
 * per pixel an edge may span (`edgesPerUnit`), and whether the projection is perspective. The image's
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

/** The largest scale of the object-to-world matrix `world`: what a displacement of the object is measured in. */
export const WORLD_SCALE_WGSL = wgslFn(
  'worldScale',
  [worldMatrix3],
  `fn worldScale(world:mat4x4f)->f32{
 let axes=worldMatrix3(world);
 return sqrt(max(dot(axes[0],axes[0]),max(dot(axes[1],axes[1]),dot(axes[2],axes[2]))));
}`,
)

/** What `farDepth` gives `cornerFactors`: the depth past which an edge is cut a quarter as finely, and how far the displacement moves a point. */
const EDGE_REACH = wgslStruct('EdgeReach', [], 'struct EdgeReach{quarterDepth:f32,reach:f32,}')

/**
 * THE FACTORS OF A PATCH'S EDGES in a view, in two parts so that a pass works out the first once for a surface and the second for each of
 * its triangles: `farDepth`, an `EdgeReach`: the depth past which an edge is cut a quarter as finely (`quarterRateDepth`) and the farthest the displacement moves a point
 * (the largest of the record `rec`'s bounds at the object's `scale`, `worldScale`); then `cornerFactors`, the factors of the three edges of a patch whose corners
 * in the row's space are the columns of `corner`, in the world of `world`, with their depths. The one rule the cut's judgement
 * (`patchFactors`), the seeding and the dicing (`dicePatch`) share. The program declares `tu` and `DisplacementRecord`.
 */
export const CORNER_FACTORS_WGSL = wgslBlock(
  'CORNER_FACTORS_WGSL',
  [TESS_VIEW, edgeFactors, quarterRateDepth, EDGE_REACH],
  `fn farDepth(rec:DisplacementRecord,scale:f32,view:TessView)->EdgeReach{
 let largest=max(-rec.bounds.x,rec.bounds.y);
 return EdgeReach(quarterRateDepth(largest,scale,view.edgesPerUnit,rec.bounds.z*tu.edgesPerPixel),largest*scale);
}
fn cornerFactors(world:mat4x4f,corner:mat3x3f,view:TessView,far:EdgeReach)->vec3f{
 let w0=(world*vec4f(corner[0],1.0)).xyz;let w1=(world*vec4f(corner[1],1.0)).xyz;let w2=(world*vec4f(corner[2],1.0)).xyz;
 let depth=vec3f(dot(view.forward,w0-view.eye),dot(view.forward,w1-view.eye),dot(view.forward,w2-view.eye));
 return edgeFactors(mat3x3f(w0,w1,w2),depth,view.near,view.perspective,view.edgesPerUnit,tu.piecesPerEdge,far.quarterDepth,far.reach);
}`,
)
