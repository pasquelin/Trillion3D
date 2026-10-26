import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL } from '../../gpu/dispatch/grid.ts'
import { PAGE_INFO_STRUCT_WGSL, VIS_UNIFORMS_WGSL, normalAtlasWgsl } from '../shader/pageWgsl.ts'
import { PAGE_NORMAL_WGSL, PAGE_POINTS_WGSL } from '../shader/pageGeometryWgsl.ts'
import { visPageIndex } from '../visWords.ts'
import { NO_WPO, type WpoSet } from '../../materials/graph/wpoProgram.ts'
import { materialTableWgsl } from '../../materials/table/materialWgsl.ts'
import { wpoGraphWgsl } from '../shader/wpoGraphWgsl.ts'
import { TESS_BINDINGS, TESS_DECLARATIONS as D } from './bindings.ts'
import { ARG_END, ARG_OCCLUDED, ARG_START, OCCLUSION_MAIN } from './contract.ts'
import { QUEUE_WGSL } from './queueWgsl.ts'
import { PATCH_SHAPE_WGSL } from './shapeWgsl.ts'
import { patchSightWgsl, SIGHT_GONE, SIGHT_HIDDEN } from './sightWgsl.ts'
import { MAIN_VIEW_WGSL } from './viewWgsl.ts'

/**
 * THE SPLITTING of a level, a thread a patch of the queue slots `start` to `end` (`ARG_START`,
 * `ARG_END`, which `plan` wrote), dispatched indirectly. A patch is placed on its triangle and judged
 * by the image's view (`patchShape`, `patchSight`): one gone from the image is left out; one the
 * pyramid hides is left out too — the main pass keeps it for the post pass, which judges it again —;
 * the others are cut finer or listed visible (`settlePatch`, `shapeWgsl.ts`).
 */
const SPLIT = `${D.indices}
${D.positions}
${D.pages}
${D.uniform}
${D.tessUniform}
${D.tess}
${D.pyramid}
${D.levels}
${D.occluded}
/** Keeps patch \`p\` for the post pass: written where the buffer has room, counted where it has none. */
fn occludePatch(p:vec4u){
 let slot=atomicAdd(&tess[tu.args+${ARG_OCCLUDED}u],1u);
 if(slot<tu.maxOccluded){
  let at=slot*4u;
  occluded[at]=p.x;occluded[at+1u]=p.y;occluded[at+2u]=p.z;occluded[at+3u]=p.w;
 }
}
@compute @workgroup_size(WORKGROUP_THREADS) fn tessSplit(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) n:vec3u){
 let slot=tw(tu.args+${ARG_START}u)+flatIndex(id,n,WORKGROUP_THREADS);
 if(slot>=tw(tu.args+${ARG_END}u)){return;}
 let piece=loadPatch(tu.queue+slot*4u);
 let page=pages[visPageIndex(piece.x)];
 let h=pageHeaderFor(page,true);
 let rec=displacementOf(page);
 let shape=patchShape(page,h,rec,piece);
 let sight=patchSight(shape.box,page.world);
 if(sight==${SIGHT_GONE}u){return;}
 if(sight==${SIGHT_HIDDEN}u){
  if(tu.occlusion==${OCCLUSION_MAIN}u){occludePatch(piece);}
  return;
 }
 settlePatch(piece,page,rec,shape,mainView(),false);
}`

/** The splitting's program, made for the project switch when `clipping`: its entry point
 *  `tessSplit`. The normal atlas it
 *  reads a float geometry's normals from is bound at `TESS_BINDINGS.normals`. With `wpo`, a patch is
 *  placed on its triangle where its surface's offset puts the corners. */
export const splitSource = (clipping = false, wpo: WpoSet = NO_WPO) =>
  wgslProgram(`${SPLIT}\n${wpo.programs.length ? D.uvs : ''}`, [
    PAGE_INFO_STRUCT_WGSL,
    VIS_UNIFORMS_WGSL,
    normalAtlasWgsl(TESS_BINDINGS.normals),
    PAGE_POINTS_WGSL,
    PAGE_NORMAL_WGSL,
    QUEUE_WGSL,
    PATCH_SHAPE_WGSL,
    MAIN_VIEW_WGSL,
    FLAT_INDEX_WGSL,
    WORKGROUP_THREADS_WGSL,
    visPageIndex,
    patchSightWgsl(clipping),
    ...(wpo.programs.length ? [materialTableWgsl(wpo.table), wpoGraphWgsl(wpo)] : []),
  ])
