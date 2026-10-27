import { wgslProgram } from '../../../../../../math/src/wgsl/assemble.ts'
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
  ARG_MAX_TRIANGLES_TWO_SIDED,
  ARG_START,
  ARG_VISIBLE,
  ARG_VISIBLE_TWO_SIDED,
  BARYCENTRIC_ONE,
  DISPATCH_DRAW,
  DISPATCH_DRAW_TWO_SIDED,
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
import { VSM_RENDER_PARAMS_WGSL, VSM_RENDER_RECORD_WGSL } from '../render/renderParamsWgsl.ts'
import { VSM_TESS_VIEW_WGSL } from './shadowViewWgsl.ts'
import { NO_WPO, type WpoSet } from '../../../../materials/graph/wpoProgram.ts'
import { materialTableWgsl } from '../../../../materials/table/materialWgsl.ts'
import { wpoGraphWgsl } from '../../../../visibility/shader/wpoGraphWgsl.ts'

/**
 * THE SHADOW MAPS' CHAIN OF PATCHES, over the records of a view pass of the casters
 * (`../render/renderPass.ts`): a displaced surface's record, marked by the cull
 * (`VSM_RENDER_CAND_TESSELLATED`, bit 23 of the record), is a window of map pages the surface casts
 * into. Its triangles are not drawn as they are: `vsmTessSeed` queues each whole as a patch — the
 * shadow maps never cut a triangle at the seeding, as the reference's raster of a virtual page does
 * not (a triangle that the image would dice at once is queued whole all the same) — named by the
 * record's index and the triangle (`record << 8 | triangle`, where the image's patches name the page
 * row and the triangle: the record carries the row, the map view and the window); `vsmTessSplit`
 * judges and cuts them level after level as the image's splitting does (`tessSplit`, over
 * `shapeWgsl.ts`), by the map's view (`vsmTessView`), a patch off the window its record draws being
 * gone (`vsmTessOnWindow`); the arguments' kernels size the seeding's dispatch by the records the
 * pass listed (`vsmTessSeedArgs`) and the two draws, the one-sided rows' and the two-sided rows',
 * by the patches the splitting listed for the rows of each kind, in a list of its own (`listVisible`,
 * `listVisibleTwoSided`), and the most triangles any of their patterns holds (`vsmTessDrawArgs`).
 *
 * Group 1 of each: 0 the pass's parameters (at its dynamic offset), 1 its counters, 2 its records
 * sorted by tier (`vsmRenderBin`, read here); group 2 of the splitting: 0 the maps' projections.
 */

/** Group 1, as the kernels read it: the pass's parameters and counters, and its records. */
const PARAMS = `@group(1) @binding(0) var<uniform> params:VsmRenderParams;
@group(1) @binding(1) var<storage,read> counts:array<u32>;`
const RECORDS = '@group(1) @binding(2) var<storage,read> vsmTessRecords:array<vec4u>;'
/** The records the pass listed, in every tier, the capacity held (`vsmRenderArgsBin`). */
const RECORD_TOTAL = `fn vsmTessRecordTotal()->u32{return vsmRenderRecordTotal(counts[VSM_RENDER_COUNT_RECORDS]);}`

/** One workgroup a record: a marked one queues every triangle of its row whole. */
const SEED = `${D.indices}
${D.positions}
${D.pages}
${D.tessUniform}
${D.tess}
${PARAMS}
${RECORDS}
${RECORD_TOTAL}
@compute @workgroup_size(WORKGROUP_THREADS) fn vsmTessSeed(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_index) lane:u32,@builtin(num_workgroups) n:vec3u){
 let index=flatIndex(group,n,1u);
 if(index>=vsmTessRecordTotal()){return;}
 let record=vsmTessRecords[index];
 if(!vsmRecordTessellated(record)){return;}
 let triangles=pages[record.x].indexCount/3u;
 for(var t=lane;t<triangles;t+=WORKGROUP_THREADS){
  queuePatch(vec4u((index<<8u)|t,${BARYCENTRIC_ONE}u,${BARYCENTRIC_ONE}u<<16u,0u));
 }
}`

/** One thread a patch of the level: the patch of the record it names, judged by the map's view. */
const SPLIT = (wpo: WpoSet) => `${D.indices}
${D.positions}
${D.pages}
${D.tessUniform}
${D.tess}
${RECORDS}
${wpo.programs.length ? D.uvs : ''}
@compute @workgroup_size(WORKGROUP_THREADS) fn vsmTessSplit(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) n:vec3u){
 let slot=tw(tu.args+${ARG_START}u)+flatIndex(id,n,WORKGROUP_THREADS);
 if(slot>=tw(tu.args+${ARG_END}u)){return;}
 let piece=loadPatch(tu.queue+slot*4u);
 let record=vsmTessRecords[piece.x>>8u];
 let page=pages[record.x];
 let rec=displacementOf(page);
 let shape=patchShape(page,pageHeaderFor(page,true),rec,piece);
 let raw=vsmProjectionData[vsmRecordMap(record)];
${wpo.programs.length ? ' wpoThreshold=raw.wpoThreshold;\n' : ''} if(!vsmTessOnWindow(shape.box,page.world,raw,record)){return;}
 settlePatch(piece,page,rec,shape,vsmTessView(raw,vsmRecordMip(record)),true);
}`

/** The arguments the seeding and the draw are launched with, one thread each. */
const ARGS = `${D.tessUniform}
${D.tess}
${D.dispatch}
${PARAMS}
${RECORD_TOTAL}
@compute @workgroup_size(1) fn vsmTessSeedArgs(){
 let grid=groupGrid(vsmTessRecordTotal());
 let at=tu.dispatch+${DISPATCH_SEED}u;
 dispatch[at]=grid.x;dispatch[at+1u]=grid.y;dispatch[at+2u]=1u;
}
@compute @workgroup_size(1) fn vsmTessDrawArgs(){
 let oneSided=tu.dispatch+${DISPATCH_DRAW}u;
 dispatch[oneSided]=3u*tw(tu.args+${ARG_MAX_TRIANGLES}u);
 dispatch[oneSided+1u]=min(tw(tu.args+${ARG_VISIBLE}u),tu.maxVisible);
 dispatch[oneSided+2u]=0u;dispatch[oneSided+3u]=0u;
 let twoSided=tu.dispatch+${DISPATCH_DRAW_TWO_SIDED}u;
 dispatch[twoSided]=3u*tw(tu.args+${ARG_MAX_TRIANGLES_TWO_SIDED}u);
 dispatch[twoSided+1u]=min(tw(tu.args+${ARG_VISIBLE_TWO_SIDED}u),tu.maxVisible);
 dispatch[twoSided+2u]=0u;dispatch[twoSided+3u]=0u;
}`

/** Group 2 of the splitting: the maps' projections, at binding 0. */
export const VSM_TESS_PROJECTION_SPECS = [{ resource: 'projectionData', binding: 0 }] as const

/** The seeding's program: its entry point `vsmTessSeed`. */
export const vsmTessSeedSource = () =>
  wgslProgram(SEED, [
    PAGE_INFO_STRUCT_WGSL,
    VSM_RENDER_PARAMS_WGSL,
    VSM_RENDER_RECORD_WGSL,
    TESS_STATE_WGSL,
    QUEUE_WGSL,
    FLAT_INDEX_WGSL,
    WORKGROUP_THREADS_WGSL,
  ])

/** The splitting's program: its entry point `vsmTessSplit`. With `wpo`, a patch is placed on its
 *  triangle where its surface's offset puts the corners, if the map's level shows the motion
 *  (`wpoThreshold`). */
export const vsmTessSplitSource = (layout: VsmLayout, wpo: WpoSet = NO_WPO) =>
  wgslProgram(SPLIT(wpo), [
    PAGE_INFO_STRUCT_WGSL,
    normalAtlasWgsl(TESS_BINDINGS.normals),
    PAGE_POINTS_WGSL,
    PAGE_NORMAL_WGSL,
    QUEUE_WGSL,
    PATTERN_WGSL,
    PATCH_SHAPE_WGSL,
    VSM_TESS_VIEW_WGSL,
    VSM_RENDER_RECORD_WGSL,
    vsmBindingsWgsl(2, VSM_TESS_PROJECTION_SPECS, layout),
    FLAT_INDEX_WGSL,
    WORKGROUP_THREADS_WGSL,
    visTriangle,
    ...(wpo.programs.length ? [materialTableWgsl(wpo.table), wpoGraphWgsl(wpo)] : []),
  ])

/** The arguments' program: its entry points `vsmTessSeedArgs` and `vsmTessDrawArgs`, the only ones
 *  that write the shadow maps' launches (the `dispatch` buffer). */
export const vsmTessArgsSource = () =>
  wgslProgram(ARGS, [VSM_RENDER_PARAMS_WGSL, TESS_STATE_WGSL, GROUP_GRID_WGSL])
