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
  ARG_START,
  ARG_WINDOWS,
  BARYCENTRIC_ONE,
  DISPATCH_DICE,
  DISPATCH_DICE_STATIC,
  DISPATCH_SEED,
  DISPATCH_WINDOWS,
  OCCLUSION_POST,
  LOSS_WINDOWS,
  PATCH_WORDS,
} from '../../../../visibility/tessellation/contract.ts'
import { PATTERN_WGSL, seededWhole } from '../../../../visibility/tessellation/patchWgsl.ts'
import { DICE_ARGS_WGSL, RESUME_ARGS_WGSL } from '../../../../visibility/tessellation/planWgsl.ts'
import {
  QUEUE_WGSL,
  TESS_LISTS_WGSL,
  TESS_STATE_WGSL,
  occludePatchText,
  resumeKernelText,
} from '../../../../visibility/tessellation/queueWgsl.ts'
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
import { vsmTessRecordWgsl } from './shadowViewWgsl.ts'
import { vsmPatchSightWgsl } from './shadowSightWgsl.ts'
import { VSM_WINDOW_STATE_WGSL } from './shadowWindowWgsl.ts'
import { NO_WPO, type WpoSet } from '../../../../materials/graph/wpoProgram.ts'
import { materialTableWgsl } from '../../../../materials/table/materialWgsl.ts'
import { wpoGraphWgsl } from '../../../../visibility/shader/wpoGraphWgsl.ts'

/**
 * THE SHADOW MAPS' CHAIN OF PATCHES, over the records of a view pass of the casters
 * (`../render/renderPass.ts`): a displaced surface's record, marked by the cull
 * (`VSM_RENDER_CAND_TESSELLATED`, bit 23 of the record), is a window of map pages the surface casts
 * into. Its triangles are not drawn as they are: `vsmTessSeed` judges each as a patch by the map's view.
 * One that no edge asks to cut finer than `SEED_SPLIT_LIMIT` and that reaches the window is listed visible
 * at once (`settleFactored`); any other is queued whole, never cut at the seeding. A patch is named by the
 * record's window and the triangle (`window << 8 | triangle`, where the image's patches name the page
 * row and the triangle: the window holds the record, which carries the row, the map and the pages, and the map's view,
 * `WINDOW_WORDS`: the seeding opens it, `vsmTessWindowFill` fills it once the levels are down, and the dicing
 * reads it, `shadowDiceWgsl.ts`); `vsmTessSplit`
 * judges and cuts them level after level as the image's splitting does (`tessSplit`, over
 * `shapeWgsl.ts`), by the map's view (`vsmTessView`), a patch off the window its record draws being
 * gone (`vsmTessOnWindow`); the arguments' kernels size the seeding's dispatch by the records the
 * pass listed (`vsmTessSeedArgs`) and the fill of the windows by the windows the seeding opened and the static layer's dicing by its patches (`vsmTessShadowArgs`); the
 * dynamic layer's dicing, by the patches the splitting listed (`listVisible`), is the image's (`tessVisibleArgs`).
 *
 * Each patch is also judged by the map's pyramid (`vsmPatchHidden`, `shadowSightWgsl.ts`), as the render cull judges a caster: the main pass
 * hides, and keeps for the post pass (`occludePatch`, in a region of `tess`), the patches the previous frame's pyramid hides, and the post pass,
 * after the pyramid is built over what the main pass drew, takes them up again (`vsmTessResume`) and drops those this frame's pyramid hides.
 *
 * Group 1 of each: 0 the pass's parameters (at its dynamic offset), 1 its counters, 2 its records
 * sorted by tier (`vsmRenderBin`, read here); group 2 of the seeding, the resume and the splitting: 0 the maps' projections, 1 the maps' uniforms;
 * group 3: the occlusion's pyramid and kept tables (`VSM_TESS_OCCLUSION_GROUP`).
 */

/** Group 1, as the kernels read it: the pass's parameters and counters, and its records. */
const PARAMS = `@group(1) @binding(0) var<uniform> params:VsmRenderParams;
@group(1) @binding(1) var<storage,read> counts:array<u32>;`
const RECORDS = '@group(1) @binding(2) var<storage,read> vsmTessRecords:array<vec4u>;'
/** The records the pass listed, in every tier, the capacity held (`vsmRenderArgsBin`). */
const RECORD_TOTAL = `fn vsmTessRecordTotal()->u32{return vsmRenderRecordTotal(counts[VSM_RENDER_COUNT_RECORDS]);}`

/** Keeps patch `p` for the post pass, in the region of the `tess` buffer that holds what the main pass's occlusion test hid
 *  (`occludedAt`): written where the region has room, counted where it has none. Only the main pass keeps; the post pass drops what it hides. */
const OCCLUDE = occludePatchText(`storePatch(tu.occludedAt+slot*${PATCH_WORDS}u,p);`)

/** What the seeding, the resume and the splitting declare, in one module: the geometry, the pages, the tessellation's state, the pass's
 *  parameters, counters and records, and the offsets' UVs where a surface wears one. */
const DECLARED = (wpo: WpoSet) => `${D.indices}
${D.positions}
${D.pages}
${D.tessUniform}
${D.tess}
${PARAMS}
${RECORDS}
${RECORD_TOTAL}
${wpo.programs.length ? D.uvs : ''}
${OCCLUDE}
${OPEN_WINDOW}
${LIVE}`

/** Opens the window of `record` (`WINDOW_WORDS`): its place among the chain's, the record's words written there; none
 *  (`VSM_NO_WINDOW`) where the chain's room for windows is spent, the count past it is what the chain lost. */
const OPEN_WINDOW = `fn vsmOpenWindow(record:vec4u)->u32{
 let window=vsmWindowBase()+atomicAdd(&tess[tu.args+${ARG_WINDOWS}u],1u);
 if(window>=tu.maxWindows){atomicAdd(&tess[tu.lost+${LOSS_WINDOWS}u],1u);return VSM_NO_WINDOW;}
 storePatch(vsmWindowAt(window),record);
 return window;
}
var<workgroup> seedWindow:u32;
var<workgroup> seedRecord:vec4u;`

/** Whether a patch of the record's surface is still to be judged: it reaches the window the record draws and the map's pyramid does not hide it. A patch off
 *  the window is gone; one the pyramid hides is kept for the post pass (\`occludePatch\`) and is not judged now. */
const LIVE = `fn vsmPatchLive(piece:vec4u,shape:PatchShape,page:PageInfo,rec:VsmPatchRecord,sight:VsmPatchSight)->bool{
 let placed=vsmPatchBox(shape.box,page.world,rec);
 if(!vsmTessOnWindow(placed,rec)){return false;}
 if(vsmPatchHidden(placed,rec,sight)){occludePatch(piece);return false;}
 return true;
}`

/** One workgroup a record: a marked one opens its window, then judges every triangle of its row as a whole patch by the map's view;
 *  the patches name the window, not the record. */
const SEED = `@compute @workgroup_size(WORKGROUP_THREADS) fn vsmTessSeed(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_index) lane:u32,@builtin(num_workgroups) n:vec3u){
 let index=flatIndex(group,n,1u);
 if(lane==0u){
  seedWindow=VSM_NO_WINDOW;
  if(index<vsmTessRecordTotal()){
   let marked=vsmTessRecords[index];
   if(vsmRecordTessellated(marked)){seedWindow=vsmOpenWindow(marked);seedRecord=marked;}
  }
 }
 let window=workgroupUniformLoad(&seedWindow);
 if(window==VSM_NO_WINDOW){return;}
 let record=workgroupUniformLoad(&seedRecord);
 let drawn=vsmTessRecordOf(record);
 let page=drawn.page;let rec=drawn.rec;let view=drawn.view;
 let far=farDepth(rec,worldScale(page.world),view);
 let patchRecord=vsmPatchRecordOf(drawn.raw,record);
 let sight=vsmPatchSightOf(drawn.raw,record);
 let triangles=page.indexCount/3u;
 let header=pageHeaderFor(page,true);
 for(var t=lane;t<triangles;t+=WORKGROUP_THREADS){
  let piece=vec4u((window<<8u)|t,${BARYCENTRIC_ONE}u,${BARYCENTRIC_ONE}u<<16u,0u);
  let shape=patchShape(page,header,rec,piece);
  let f=cornerFactors(page.world,shape.corner,view,far);
  if(!seededWhole(f)){
   queuePatch(piece);
  }else if(vsmPatchLive(piece,shape,page,patchRecord,sight)){
   settleFactored(piece,shape,f,vsmRecordStatic(record));
  }
 }
}`

/** One thread a patch of the level: the patch of the record it names, judged by the map's view. */
const SPLIT = `@compute @workgroup_size(WORKGROUP_THREADS) fn vsmTessSplit(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) n:vec3u){
 let slot=tw(tu.args+${ARG_START}u)+flatIndex(id,n,WORKGROUP_THREADS);
 if(slot>=tw(tu.args+${ARG_END}u)){return;}
 let piece=loadPatch(tu.queue+slot*4u);
 let record=vsmWindowRecord(piece.x>>8u);
 let drawn=vsmTessRecordOf(record);
 let page=drawn.page;
 let shape=patchShape(page,pageHeaderFor(page,true),drawn.rec,piece);
 if(vsmPatchLive(piece,shape,page,vsmPatchRecordOf(drawn.raw,record),vsmPatchSightOf(drawn.raw,record))){
  settlePatch(piece,page,drawn.rec,shape,drawn.view,vsmRecordStatic(record));
 }
}`

/** The post pass's resume, a thread a patch the main pass's occlusion test hid (`ARG_OCCLUDED` of the main pass's state, at most `maxOccluded`,
 *  dispatched indirectly by `tessResumeArgs`): queued as the seeding queues a triangle, to be judged again against this frame's pyramid. */
const RESUME = resumeKernelText('vsmTessResume', `loadPatch(tu.occludedAt+slot*${PATCH_WORDS}u)`)

/** The arguments the seeding, the post pass's resume and the fill of the windows and of the dicing are launched with, one thread each: the seeding's
 *  and the resume's together, before the seeding, the windows' and the dicing's of both layers together, once the levels are down. */
const ARGS = `${D.tessUniform}
${D.tess}
${D.dispatch}
${PARAMS}
${RECORD_TOTAL}
@compute @workgroup_size(1) fn vsmTessSeedArgs(){
 let grid=groupGrid(vsmTessRecordTotal());
 let at=tu.dispatch+${DISPATCH_SEED}u;
 dispatch[at]=grid.x;dispatch[at+1u]=grid.y;dispatch[at+2u]=1u;
 // The post pass takes up what the main pass hid: the main pass's state is final by now, and nothing the seeding does changes it.
 if(tu.occlusion==${OCCLUSION_POST}u){resumeDispatch();}
}
@compute @workgroup_size(1) fn vsmTessShadowArgs(){
 let windows=groupGrid(vsmWindowCount());
 let at=tu.dispatch+${DISPATCH_WINDOWS}u;
 dispatch[at]=windows.x;dispatch[at+1u]=windows.y;dispatch[at+2u]=1u;
 diceArgs(listCounter(0u),${DISPATCH_DICE}u);
 diceArgs(listCounter(1u),${DISPATCH_DICE_STATIC}u);
}`

/** Group 2 of the seeding, the resume and the splitting: the maps' projections, at binding 0, and the maps' uniforms, at 1, which the occlusion test reads
 *  (`vsmPatchHidden`). */
export const VSM_TESS_PROJECTION_SPECS = [
  { resource: 'projectionData', binding: 0 },
  { resource: 'uniforms', binding: 1 },
] as const

/** What the patches' program is made of: the patch, its shape and factors, the map's view and the maps' projections. */
const splitDependencies = (layout: VsmLayout, wpo: WpoSet) => [
  PAGE_INFO_STRUCT_WGSL,
  normalAtlasWgsl(TESS_BINDINGS.normals),
  PAGE_POINTS_WGSL,
  PAGE_NORMAL_WGSL,
  QUEUE_WGSL,
  PATTERN_WGSL,
  PATCH_SHAPE_WGSL,
  seededWhole,
  VSM_WINDOW_STATE_WGSL,
  vsmTessRecordWgsl(wpo.programs.length > 0),
  vsmPatchSightWgsl(layout.prefilteredDistant),
  VSM_RENDER_RECORD_WGSL,
  vsmBindingsWgsl(2, VSM_TESS_PROJECTION_SPECS, layout),
  FLAT_INDEX_WGSL,
  WORKGROUP_THREADS_WGSL,
  visTriangle,
  ...(wpo.programs.length ? [materialTableWgsl(wpo.table), wpoGraphWgsl(wpo)] : []),
]

/** The patches' program: its entry points `vsmTessSeed`, `vsmTessResume` and `vsmTessSplit`, over the splitting's own groups (the maps'
 *  projections in group 2). With `wpo`, a patch is placed on its triangle where its surface's offset puts the corners, if the map's level
 *  shows the motion (`wpoThreshold`). */
export const vsmTessSource = (layout: VsmLayout, wpo: WpoSet = NO_WPO) =>
  wgslProgram(`${DECLARED(wpo)}\n${SEED}\n${SPLIT}\n${RESUME}`, [
    VSM_RENDER_PARAMS_WGSL,
    ...splitDependencies(layout, wpo),
  ])

/** The arguments' program: its entry points `vsmTessSeedArgs` and `vsmTessShadowArgs`, the only ones
 *  that write the shadow maps' launches (the `dispatch` buffer). */
export const vsmTessArgsSource = () =>
  wgslProgram(ARGS, [
    VSM_RENDER_PARAMS_WGSL,
    TESS_STATE_WGSL,
    TESS_LISTS_WGSL,
    DICE_ARGS_WGSL,
    RESUME_ARGS_WGSL,
    GROUP_GRID_WGSL,
    VSM_WINDOW_STATE_WGSL,
  ])
