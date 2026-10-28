import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL } from '../../gpu/dispatch/grid.ts'
import { PAGE_INFO_STRUCT_WGSL, VIS_UNIFORMS_WGSL } from '../shader/pageWgsl.ts'
import { PAGE_POINTS_WGSL } from '../shader/pageGeometryWgsl.ts'
import { visTriangle } from '../visWords.ts'
import { NO_WPO, type WpoSet } from '../../materials/graph/wpoProgram.ts'
import { materialTableWgsl } from '../../materials/table/materialWgsl.ts'
import { wpoGraphWgsl } from '../shader/wpoGraphWgsl.ts'
import { TESS_DECLARATIONS as D } from './bindings.ts'
import { BARYCENTRIC_ONE, SEED_SPLIT_LIMIT } from './contract.ts'
import { CHILDREN_WGSL, QUEUE_WGSL, resumeKernelText } from './queueWgsl.ts'
import { coarseFactors, seededWhole } from './patchWgsl.ts'
import { CORNER_FACTORS_WGSL, MAIN_VIEW_WGSL, WORLD_SCALE_WGSL } from './viewWgsl.ts'
import { TESSELLATED_FLAGS_WGSL } from './rowWgsl.ts'
import { LIST_TESS_AT, LIST_TESS_COUNT } from '../raster/contract.ts'

/**
 * THE SEEDING of the patches, one workgroup a cluster of the pass's list of tessellated clusters
 * (`LIST_TESS_COUNT`, `../raster/contract.ts`), in the compute pass of the pass's binning: the cut
 * left the clusters whose surface the frame tessellates to it (`VIS_TAG_TESSELLATED`,
 * `../../geometry/dag/shader/visibleWgsl.ts`), which the bins listed. Each triangle of a cluster is
 * measured — the factors of its three edges (`cornerFactors`), from the world
 * positions of its corners, the depth of the nearer end and the view's scale — and handed to the
 * splitting queue: whole where no edge asks for more than `SEED_SPLIT_LIMIT` pieces, else already
 * cut once, by the pattern of its factors over `TABLE_SIZE` held to that limit (`queueChildren`),
 * so no patch a level meets asks for more than a pattern holds eight times over.
 */
const SEED = `${D.indices}
${D.positions}
${D.pages}
${D.uniform}
${D.tessUniform}
${D.lists}
${D.tess}
${D.occludedRead}
@compute @workgroup_size(WORKGROUP_THREADS) fn tessSeed(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_index) lane:u32,@builtin(num_workgroups) n:vec3u){
 let at=flatIndex(group,n,1u);
 if(at>=lists[tu.list+${LIST_TESS_COUNT}u]){return;}
 let page=pages[lists[lists[tu.list+${LIST_TESS_AT}u]+at]];
 if(!tessellatedFlags(page)){return;}
 let h=pageHeaderFor(page,false);
 let rec=displacementOf(page);
 let view=mainView();
 let far=farDepth(rec,worldScale(page.world),view);
 let whole=mat3x3f(vec3f(1.0,0.0,0.0),vec3f(0.0,1.0,0.0),vec3f(0.0,0.0,1.0));
 let triangles=page.indexCount/3u;
 for(var t=lane;t<triangles;t+=WORKGROUP_THREADS){
  let p=pageTrianglePositions(page,h,pageTriangle(page,h,t));
  let f=cornerFactors(page.world,p,view,far);
  let id=page.packedBase|visTriangle(t);
  if(seededWhole(f)){queuePatch(vec4u(id,${BARYCENTRIC_ONE}u,${BARYCENTRIC_ONE}u<<16u,0u));}
  else{queueChildren(id,whole,min(coarseFactors(f),vec3f(${SEED_SPLIT_LIMIT}.0)),false);}
 }
}`

/**
 * THE POST PASS'S RESUME, a thread a patch the main pass's occlusion test hid (`ARG_OCCLUDED` of the
 * main pass's state, at most `maxOccluded`, dispatched indirectly by `tessResumeArgs`): it is
 * queued as the seeding queues a triangle, to be split and judged again against this image's
 * pyramid.
 */
const RESUME = resumeKernelText(
  'tessResume',
  'vec4u(occluded[slot*4u],occluded[slot*4u+1u],occluded[slot*4u+2u],occluded[slot*4u+3u])',
)

/** The seeding's program: its entry points `tessSeed` and `tessResume`. With `wpo`, a triangle is
 *  measured where its surface's offset puts its corners. */
export const seedSource = (wpo: WpoSet = NO_WPO) =>
  wgslProgram(`${SEED}\n${RESUME}\n${wpo.programs.length ? D.uvs : ''}`, [
    PAGE_INFO_STRUCT_WGSL,
    VIS_UNIFORMS_WGSL,
    PAGE_POINTS_WGSL,
    QUEUE_WGSL,
    CHILDREN_WGSL,
    TESSELLATED_FLAGS_WGSL,
    FLAT_INDEX_WGSL,
    WORKGROUP_THREADS_WGSL,
    visTriangle,
    MAIN_VIEW_WGSL,
    CORNER_FACTORS_WGSL,
    WORLD_SCALE_WGSL,
    coarseFactors,
    seededWhole,
    ...(wpo.programs.length ? [materialTableWgsl(wpo.table), wpoGraphWgsl(wpo)] : []),
  ])
