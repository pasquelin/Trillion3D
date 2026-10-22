import { wgslProgram } from '../../../../../../math/src/wgsl/assemble.ts'
import { bitIsSet } from '../../../../../../math/src/wgsl/integer.ts'
import {
  FLAT_INDEX_WGSL,
  GROUP_GRID_WGSL,
  WORKGROUP_THREADS_WGSL,
} from '../../../../gpu/dispatch/grid.ts'
import {
  TESS_DECLARATIONS as D,
  TESS_BINDINGS,
} from '../../../../visibility/tessellation/bindings.ts'
import {
  ARG_END,
  ARG_MAX_TRIANGLES,
  ARG_START,
  ARG_VISIBLE,
  BARYCENTRIC_ONE,
  DISPATCH_DRAW,
  DISPATCH_SEED,
} from '../../../../visibility/tessellation/contract.ts'
import { PATTERN_WGSL } from '../../../../visibility/tessellation/patchWgsl.ts'
import { QUEUE_WGSL, TESS_STATE_WGSL } from '../../../../visibility/tessellation/queueWgsl.ts'
import { PATCH_SHAPE_WGSL } from '../../../../visibility/tessellation/shapeWgsl.ts'
import { PAGE_INFO_STRUCT_WGSL, normalAtlasWgsl } from '../../../../visibility/shader/pageWgsl.ts'
import {
  PAGE_NORMAL_WGSL,
  PAGE_POINTS_WGSL,
} from '../../../../visibility/shader/pageGeometryWgsl.ts'
import { visTriangle } from '../../../../visibility/visWords.ts'
import { vsmBindingsWgsl } from '../resources.ts'
import type { VsmLayout } from '../layout.ts'
import { VSM_RENDER_PARAMS_WGSL } from '../render/renderParamsWgsl.ts'
import { VSM_TESS_VIEW_WGSL } from './shadowViewWgsl.ts'

/**
 * THE SHADOW MAPS' CHAIN OF PATCHES, over the pairs of one chunk of casters (`../render/renderPass.ts`):
 * a displaced surface's pair, marked by the command that made it (`VSM_RENDER_CAND_TESSELLATED`, bit
 * 23 of the pair), is a map page the surface casts into. Its triangles are not drawn as they are:
 * `vsmTessSeed` queues each whole as a patch — the shadow maps never cut a triangle at the seeding, as
 * the reference's raster of a virtual page does not (a triangle that the image would dice at once is
 * queued whole all the same) — named by the pair's index and the triangle (`pair << 8 | triangle`,
 * where the image's patches name the page row and the triangle: the pair carries the row, the map
 * view and the page); `vsmTessSplit` judges and cuts them level after level as the image's splitting
 * does (`tessSplit`, over `shapeWgsl.ts`), by the map's view (`vsmTessView`), a patch off the page
 * its pair draws being gone (`vsmTessOnPage`); the arguments' kernels size the seeding's dispatch by
 * the pairs the chunk listed (`vsmTessSeedArgs`) and the draw by the patches the splitting listed
 * and the most triangles any of their patterns holds (`vsmTessDrawArgs`).
 *
 * Group 1 of each: 0 the chunk's parameters (at its dynamic offset), 1 its counters, 2 its pairs
 * (`vsmRenderExpand`, read here); group 2 of the splitting: 0 the maps' projections.
 */

/** Group 1, as the kernels read it: the chunk's parameters and counters, and its pairs. */
const PARAMS = `@group(1) @binding(0) var<uniform> params:VsmRenderParams;
@group(1) @binding(1) var<storage,read> counts:array<u32>;`
const PAIRS = '@group(1) @binding(2) var<storage,read> vsmTessPairs:array<vec4u>;'
/** The pairs the chunk listed, in every tier, the capacity held (`vsmRenderArgsDraw`). */
const PAIR_TOTAL = `fn vsmTessPairTotal()->u32{
 var total=0u;
 for(var t=0u;t<VSM_RENDER_TIERS;t++){total+=counts[vsmRenderChunkCounter(params.chunk,VSM_RENDER_TIER_PAIRS+t)];}
 return min(total,params.pairCapacity);
}`

/** One workgroup a pair: a marked one queues every triangle of its row whole. */
const SEED = `${D.indices}
${D.positions}
${D.pages}
${D.tessUniform}
${D.tess}
${PARAMS}
${PAIRS}
${PAIR_TOTAL}
@compute @workgroup_size(WORKGROUP_THREADS) fn vsmTessSeed(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_index) lane:u32,@builtin(num_workgroups) n:vec3u){
 let index=flatIndex(group,n,1u);
 if(index>=vsmTessPairTotal()){return;}
 let pair=vsmTessPairs[index];
 if(!bitIsSet(pair.y,23u)){return;}
 let triangles=pages[pair.x].indexCount/3u;
 for(var t=lane;t<triangles;t+=WORKGROUP_THREADS){
  queuePatch(vec4u((index<<8u)|t,${BARYCENTRIC_ONE}u,${BARYCENTRIC_ONE}u<<16u,0u));
 }
}`

/** One thread a patch of the level: the patch of the pair it names, judged by the map's view. */
const SPLIT = `${D.indices}
${D.positions}
${D.pages}
${D.tessUniform}
${D.tess}
${PAIRS}
@compute @workgroup_size(WORKGROUP_THREADS) fn vsmTessSplit(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) n:vec3u){
 let slot=tw(tu.args+${ARG_START}u)+flatIndex(id,n,WORKGROUP_THREADS);
 if(slot>=tw(tu.args+${ARG_END}u)){return;}
 let piece=loadPatch(tu.queue+slot*4u);
 let pair=vsmTessPairs[piece.x>>8u];
 let page=pages[pair.x];
 let rec=displacementOf(page);
 let shape=patchShape(page,pageHeaderFor(page,true),rec,piece);
 let raw=vsmProjectionData[pair.y&0xFFFFu];
 if(!vsmTessOnPage(shape.box,page.world,raw,pair)){return;}
 settlePatch(piece,page,rec,shape,vsmTessView(raw,(pair.y>>16u)&7u),true);
}`

/** The arguments the seeding and the draw are launched with, one thread each. */
const ARGS = `${D.tessUniform}
${D.tess}
${D.dispatch}
${PARAMS}
${PAIR_TOTAL}
@compute @workgroup_size(1) fn vsmTessSeedArgs(){
 let grid=groupGrid(vsmTessPairTotal());
 let at=tu.dispatch+${DISPATCH_SEED}u;
 dispatch[at]=grid.x;dispatch[at+1u]=grid.y;dispatch[at+2u]=1u;
}
@compute @workgroup_size(1) fn vsmTessDrawArgs(){
 let at=tu.dispatch+${DISPATCH_DRAW}u;
 dispatch[at]=3u*tw(tu.args+${ARG_MAX_TRIANGLES}u);
 dispatch[at+1u]=min(tw(tu.args+${ARG_VISIBLE}u),tu.maxVisible);
 dispatch[at+2u]=0u;dispatch[at+3u]=0u;
}`

/** Group 2 of the splitting: the maps' projections, at binding 0. */
export const VSM_TESS_PROJECTION_SPECS = [{ resource: 'projectionData', binding: 0 }] as const

/** The seeding's program: its entry point `vsmTessSeed`. */
export const vsmTessSeedSource = () =>
  wgslProgram(SEED, [
    PAGE_INFO_STRUCT_WGSL,
    VSM_RENDER_PARAMS_WGSL,
    TESS_STATE_WGSL,
    QUEUE_WGSL,
    FLAT_INDEX_WGSL,
    WORKGROUP_THREADS_WGSL,
    bitIsSet,
  ])

/** The splitting's program: its entry point `vsmTessSplit`. */
export const vsmTessSplitSource = (layout: VsmLayout) =>
  wgslProgram(SPLIT, [
    PAGE_INFO_STRUCT_WGSL,
    normalAtlasWgsl(TESS_BINDINGS.normals),
    PAGE_POINTS_WGSL,
    PAGE_NORMAL_WGSL,
    QUEUE_WGSL,
    PATTERN_WGSL,
    PATCH_SHAPE_WGSL,
    VSM_TESS_VIEW_WGSL,
    vsmBindingsWgsl(2, VSM_TESS_PROJECTION_SPECS, layout),
    FLAT_INDEX_WGSL,
    WORKGROUP_THREADS_WGSL,
    visTriangle,
  ])

/** The arguments' program: its entry points `vsmTessSeedArgs` and `vsmTessDrawArgs`, the only ones
 *  that write the shadow maps' launches (the `dispatch` buffer). */
export const vsmTessArgsSource = () =>
  wgslProgram(ARGS, [VSM_RENDER_PARAMS_WGSL, TESS_STATE_WGSL, GROUP_GRID_WGSL])
