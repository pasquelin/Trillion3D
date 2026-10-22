import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { worldMatrix3 } from '../../../../math/src/wgsl/matrix.ts'
import { FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL } from '../../gpu/dispatch/grid.ts'
import { DRAW_MASK_WGSL } from '../../geometry/dag/shader/drawMaskWgsl.ts'
import { PAGE_INFO_STRUCT_WGSL, VIS_UNIFORMS_WGSL } from '../shader/pageWgsl.ts'
import { PAGE_POINTS_WGSL } from '../shader/pageGeometryWgsl.ts'
import { visTriangle } from '../visWords.ts'
import { TESS_DECLARATIONS as D } from './bindings.ts'
import { ARG_OCCLUDED, BARYCENTRIC_ONE, SEED_SPLIT_LIMIT } from './contract.ts'
import { CHILDREN_WGSL, QUEUE_WGSL } from './queueWgsl.ts'
import { edgeFactors, quarterRateDepth, coarseFactors } from './patchWgsl.ts'
import { TESSELLATED_ROW_WGSL } from './rowWgsl.ts'

/**
 * THE SEEDING of the patches, one workgroup a row of the page table, in the compute pass of the
 * pass's binning, after the split of the rasters has left the tessellated rows to it
 * (`../raster/binWgsl.ts`, `tessellatedRow`). Each triangle of a row the cut draws and the frame
 * tessellates is measured — the factors of its three edges (`edgeFactors`), from the world
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
${D.mask}
${D.tess}
${D.occludedRead}
@compute @workgroup_size(WORKGROUP_THREADS) fn tessSeed(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_index) lane:u32,@builtin(num_workgroups) n:vec3u){
 let row=flatIndex(group,n,1u);
 if(row>=uni.pageCount){return;}
 let page=pages[row];
 if(!(uni.selectionEnabled==0u||maskSelects(page.selectionIndex))){return;}
 if(!tessellatedRow(page)){return;}
 let h=pageHeaderFor(page,false);
 let rec=displacementOf(page);
 let axes=worldMatrix3(page.world);
 let scale=sqrt(max(dot(axes[0],axes[0]),max(dot(axes[1],axes[1]),dot(axes[2],axes[2]))));
 let far=quarterRateDepth(max(-rec.bounds.x,rec.bounds.y),scale,tu.edgesPerUnit,rec.bounds.z*tu.edgesPerPixel);
 let perspective=uni.perspective>0.0;
 let whole=mat3x3f(vec3f(1.0,0.0,0.0),vec3f(0.0,1.0,0.0),vec3f(0.0,0.0,1.0));
 let triangles=page.indexCount/3u;
 for(var t=lane;t<triangles;t+=WORKGROUP_THREADS){
  let p=pageTrianglePositions(page,h,pageTriangle(page,h,t));
  let w0=(page.world*vec4f(p[0],1.0)).xyz;let w1=(page.world*vec4f(p[1],1.0)).xyz;let w2=(page.world*vec4f(p[2],1.0)).xyz;
  let depth=vec3f(dot(uni.forward,w0-uni.eye),dot(uni.forward,w1-uni.eye),dot(uni.forward,w2-uni.eye));
  let f=edgeFactors(mat3x3f(w0,w1,w2),depth,uni.near,perspective,tu.edgesPerUnit,tu.piecesPerEdge,far);
  let id=page.packedBase|visTriangle(t);
  if(max(f.x,max(f.y,f.z))<=${SEED_SPLIT_LIMIT}.0){queuePatch(vec4u(id,${BARYCENTRIC_ONE}u,${BARYCENTRIC_ONE}u<<16u,0u));}
  else{queueChildren(id,whole,min(coarseFactors(f),vec3f(${SEED_SPLIT_LIMIT}.0)),false);}
 }
}`

/**
 * THE POST PASS'S RESUME, a thread a patch the main pass's occlusion test hid (`ARG_OCCLUDED` of the
 * main pass's state, at most `maxOccluded`, dispatched indirectly by `tessResumeArgs`): it is
 * queued as the seeding queues a triangle, to be split and judged again against this image's
 * pyramid.
 */
const RESUME = `@compute @workgroup_size(WORKGROUP_THREADS) fn tessResume(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) n:vec3u){
 let slot=flatIndex(id,n,WORKGROUP_THREADS);
 if(slot>=min(tw(tu.mainArgs+${ARG_OCCLUDED}u),tu.maxOccluded)){return;}
 let at=slot*4u;
 queuePatch(vec4u(occluded[at],occluded[at+1u],occluded[at+2u],occluded[at+3u]));
}`

/** The seeding's program: its entry points `tessSeed` and `tessResume`. */
export const seedSource = () =>
  wgslProgram(`${SEED}\n${RESUME}`, [
    PAGE_INFO_STRUCT_WGSL,
    VIS_UNIFORMS_WGSL,
    PAGE_POINTS_WGSL,
    QUEUE_WGSL,
    CHILDREN_WGSL,
    TESSELLATED_ROW_WGSL,
    DRAW_MASK_WGSL,
    FLAT_INDEX_WGSL,
    WORKGROUP_THREADS_WGSL,
    worldMatrix3,
    visTriangle,
    edgeFactors,
    quarterRateDepth,
    coarseFactors,
  ])
