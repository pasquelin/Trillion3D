/**
 * THE ROOTS' HARDWARE OCCLUSION QUERIES (`hardwareOcclusion.ts`): the boxes of sixteen roots drawn under one query, depth tested and written nowhere, then each root's verdict
 * from the count its group's query came back with.
 *
 *   params    uniform        `HZB_PARAMS_WGSL`, the view-projection at the render origin the corners are at
 *   corners   array<u32>     `CORNER_VALUES` a root, the box's eight corners each coordinate as its single rounding then its residue (`../hzbOcclusion/hzbCornersWgsl.ts`)
 *   unculled  array<u32>     a bit a root: set where the root is never rejected
 *   samples   array<vec2u>   the count of every query, a 64-bit word
 *   verdict   array<u32>     a word a root, non-zero where its group let no sample through
 */
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { wgslConsts } from '../../../../math/src/wgsl/consts.ts'
import { CORNER_VALUES } from '../../gpu/core/boxProjectWgsl.ts'
import { FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL } from '../../gpu/dispatch/grid.ts'
import { HZB_PARAMS_WGSL } from '../hzbOcclusion/hzbCornersWgsl.ts'

/** The roots whose boxes one query counts the samples of. */
export const QUERY_BATCH = 16
/** The vertices a root's box is drawn with: twelve triangles. */
export const BOX_VERTICES = 36
/** The most queries a query set holds. */
export const MAX_QUERIES = 4096

export const OCCLUSION_BOX_ENTRY = 'occlusionBox'
export const OCCLUSION_VERDICT_ENTRY = 'occlusionVerdict'

const CORNERS_WGSL = wgslBlock(
  'HARDWARE_OCCLUSION_CORNERS_WGSL',
  [HZB_PARAMS_WGSL],
  `@group(0) @binding(1) var<storage,read> corners:array<u32>;
${wgslConsts({ CORNER_VALUES })}
fn boxCorner(root:u32,k:u32)->vec4f{
 let at=root*CORNER_VALUES+k*6u;
 let p=vec3f(bitcast<f32>(corners[at])+bitcast<f32>(corners[at+3u]),bitcast<f32>(corners[at+1u])+bitcast<f32>(corners[at+4u]),bitcast<f32>(corners[at+2u])+bitcast<f32>(corners[at+5u]));
 return params.viewProj*vec4f(p,1.0);
}
`,
)

/** The box's vertex stage: one root an instance, its twelve triangles by corner (bit 0 x, bit 1 y, bit 2 z). */
export const OCCLUSION_BOX_WGSL = wgslProgram(
  `const BOX=array<u32,36>(0u,2u,1u,1u,2u,3u,4u,5u,6u,5u,7u,6u,0u,4u,2u,2u,4u,6u,1u,3u,5u,3u,7u,5u,0u,1u,4u,1u,5u,4u,2u,6u,3u,3u,6u,7u);
@vertex fn ${OCCLUSION_BOX_ENTRY}(@builtin(vertex_index) v:u32,@builtin(instance_index) root:u32)->@builtin(position) vec4f{
 return boxCorner(root,BOX[v]);
}`,
  [CORNERS_WGSL],
)

/** The verdict kernel: a root is hidden when its group's count is zero and it is neither never rejected nor a box with a corner at or behind the eye's plane
 *  (the near plane crossing the bounds is no query's to answer). */
export const OCCLUSION_VERDICT_WGSL = wgslProgram(
  `@group(0) @binding(2) var<storage,read> unculled:array<u32>;
@group(0) @binding(3) var<storage,read> samples:array<vec2u>;
@group(0) @binding(4) var<storage,read_write> verdict:array<u32>;
const QUERY_BATCH=${QUERY_BATCH}u;
const MAX_QUERIES=${MAX_QUERIES}u;
@compute @workgroup_size(WORKGROUP_THREADS) fn ${OCCLUSION_VERDICT_ENTRY}(@builtin(global_invocation_id) g:vec3u,@builtin(num_workgroups) n:vec3u){
 let root=flatIndex(g,n,WORKGROUP_THREADS);
 if(root>=params.counts.x){return;}
 let query=root/QUERY_BATCH;
 var hidden=query<MAX_QUERIES&&all(samples[query]==vec2u(0u))&&(unculled[root>>5u]&(1u<<(root&31u)))==0u;
 for(var k=0u;k<8u&&hidden;k++){hidden=boxCorner(root,k).w>0.0;}
 verdict[root]=select(0u,1u,hidden);
}`,
  [CORNERS_WGSL, FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL],
)
