import { CUT_RULE_WGSL } from '../../../../geometry/cut/rule.ts'
import { FLOAT32_MAX } from '../../../../../../math/src/wgsl/constants.ts'
import { FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL } from '../../../../gpu/dispatch/grid.ts'
import { projectedBoundWgsl } from '../../../../geometry/dag/shader/projectedBoundWgsl.ts'
import { MOBILITY_FAR_SHADOW, MOBILITY_MOVING, MOBILITY_SHADOWLESS } from '../../mobilityBits.ts'
import { PAGE_INFO_STRUCT_WGSL } from '../../../../visibility/shader/pageWgsl.ts'
import {
  FLAG_BACK,
  FLAG_BLEND_CASTER,
  FLAG_DOUBLE,
  FLAG_SPRITE,
  FLAG_VOXEL,
} from '../../../../visibility/types.ts'
import { matrixWindingCw } from '../../../../../../math/src/wgsl/matrix.ts'
import { wgslProgram } from '../../../../../../math/src/wgsl/assemble.ts'
import { wgslBlock, wgslConst } from '../../../../../../math/src/wgsl/decl.ts'
import { recordTextureWgsl } from '../../../../gpu/core/recordTextureWgsl.ts'
import { COLD_TABLE } from '../../../../geometry/dag/cut/cutTables.ts'
import {
  DRAW_DISTANCE_MARK,
  DRAW_FAR_WORD,
  DRAW_NEAR_WORD,
  frameTableWgsl,
} from '../../../../geometry/dag/frameTable.ts'
import { OUTSIDE_DRAW_DISTANCES_WGSL } from '../../../../geometry/dag/shader/drawDistanceWgsl.ts'
import { worldGateWgsl } from '../../../../geometry/dag/shader/worldGateWgsl.ts'
import { VSM_RENDER_PARAMS_WGSL } from './renderParamsWgsl.ts'

/** THE NON-CLUSTER RASTER'S CASTER CANDIDATES (`renderCullWgsl.ts`): one thread a row, the rows the
 *  camera's cut selects appended with their sphere and flags. */

/** The render cull's `INF`, the bound `projectedBound` returns past the near plane: the greatest
 *  finite f32. */
const VSM_INF = wgslConst('INF', [FLOAT32_MAX], 'const INF:f32=FLOAT32_MAX;')

/** The group of a candidates kernel that binds the camera cut's world switch
 *  (`VSM_RENDER_WORLD_WGSL`). */
export const VSM_RENDER_WORLD_GROUP = 1

/**
 * The camera cut's world switch, as its descent reads it (`worldGateWgsl`): its cold words at 0
 * and its frame words at 1 of `VSM_RENDER_WORLD_GROUP`, under the cut's names, and the cold word
 * its placements' links start at in the parameters (`VsmRenderParams.worldLinks`). A cut that
 * follows no world has it zero, and a stand-in bound for both tables (`vsmWorldGroup`), of which
 * the gate reads no word. At 2, the words of the cut's `work` the main view's filter lies in
 * (`filterBits`, `VsmRenderParams.filterBase`): a stand-in word for a view that filters none.
 */
const VSM_RENDER_WORLD_WGSL = wgslBlock(
  'VSM_RENDER_WORLD_WGSL',
  [
    recordTextureWgsl(COLD_TABLE, {
      name: 'cold',
      group: VSM_RENDER_WORLD_GROUP,
      binding: 0,
      access: 'read',
    }),
    frameTableWgsl('frames', { group: VSM_RENDER_WORLD_GROUP, binding: 1, access: 'read' }),
    worldGateWgsl('params.worldLinks'),
  ],
  `@group(${VSM_RENDER_WORLD_GROUP}) @binding(2) var<storage,read> filterBits:array<u32>;
/** Whether the main view does not draw placement \`w\` (\`Camera.hidden\`, \`Camera.showOnly\`): its bit
 *  in the view's filter, the one the camera's cut tests its roots by (\`filteredOut\`). A shadow is of
 *  what the view draws: a hidden object casts none. None when the parameters name no filter. */
fn vsmRenderFilteredOut(w:u32)->bool{
 let at=params.filterBase+(w>>5u);
 if(params.filterBase==0u||at>=arrayLength(&filterBits)){return false;}
 return (filterBits[at]&(1u<<(w&31u)))!=0u;
}`,
)

/**
 * What a candidates kernel reads of the caster rows — group 0: 0 params (uniform, dynamic), 1 page
 * table rows (`pages`), 2 row spheres, 3 row mobility words, 4 row levels of detail, 5
 * candidates (rw), 6 counters (rw atomic); group 1 the camera cut's world switch
 * (`VSM_RENDER_WORLD_WGSL`) — and the main view's pixels of a row's error: the
 * opaque rows' (`vsmRenderCandidatesWgsl`) and the blended rows' (`../transmission/transmissionClearWgsl.ts`).
 */
export const VSM_RENDER_ROWS_WGSL = wgslBlock(
  'VSM_RENDER_ROWS_WGSL',
  [
    PAGE_INFO_STRUCT_WGSL,
    VSM_RENDER_PARAMS_WGSL,
    projectedBoundWgsl(VSM_INF),
    CUT_RULE_WGSL,
    matrixWindingCw,
    VSM_RENDER_WORLD_WGSL,
    OUTSIDE_DRAW_DISTANCES_WGSL,
  ],
  `
struct VsmRenderSphere{c:vec4f,l:vec4f,}
struct VsmRenderRowLod{own:vec4f,parent:vec4f,ownLow:vec4f,parentLow:vec4f,radii:vec4f,object:vec4f,}
@group(0) @binding(0) var<uniform> params:VsmRenderParams;
@group(0) @binding(1) var<storage,read> pages:array<PageInfo>;
@group(0) @binding(2) var<storage,read> spheres:array<VsmRenderSphere>;
@group(0) @binding(3) var<storage,read> mobility:array<u32>;
@group(0) @binding(4) var<storage,read> lods:array<VsmRenderRowLod>;
@group(0) @binding(5) var<storage,read_write> candidates:array<VsmRenderCandidate>;
@group(0) @binding(6) var<storage,read_write> counts:array<atomic<u32>>;
/** Error \`lod\` (world centre high + error, low residue) in the main view's pixels. */
fn vsmRenderMainPixels(lod:vec4f,low:vec4f,radius:f32)->f32{
 let delta=(lod.xyz-params.eyeHigh)+(low.xyz-params.eyeLow);
 let v=vec3f(dot(params.viewRow0.xyz,delta),dot(params.viewRow1.xyz,delta),dot(params.viewRow2.xyz,delta));
 return projectedBound(lod.w,v,radius,1.0,params.focal,params.near,params.perspective);
}
/** A caster row's candidate flags, from its mobility word and deformation output: cached as dynamic
 *  while its placement moves, and deforming — its pages invalidated as it draws them —
 *  only then. A deformed placement turns static once its deformation has
 *  held still for VSM_STILL_FRAMES frames, and its next change moves it again before
 *  this frame's raster, its box staling the static pages (\`noteDeformed\`,
 *  \`webgpu/pages/render/movedGeometry.ts\`): a static deformed row draws the geometry its static
 *  pages hold, and invalidating them each frame it draws them would redraw them every frame. */
fn vsmRenderCandidateFlags(word:u32,deformOutput:u32)->u32{
 if((word&${MOBILITY_MOVING}u)==0u){return 0u;}
 return VSM_RENDER_CAND_DYNAMIC|select(0u,VSM_RENDER_CAND_DEFORMING,deformOutput!=0u);
}
/** A caster row's far-shadow flags, for the suns' test (\`vsmFarShadowSkipped\`): tested when the
 *  parameters say every mesh is (\`farMeshes\`) or the row belongs to the world's merged shells — a
 *  placement of the world DAG (\`worldPlaced\`), asked of \`placement\` only then —, and casting far
 *  when its object does (\`MOBILITY_FAR_SHADOW\` of its mobility \`word\`). The objects drawn as
 *  themselves keep casting at any distance unless the parameters ask for every mesh. */
fn vsmRenderFarFlags(word:u32,placement:u32)->u32{
 return select(0u,VSM_RENDER_CAND_FAR_TESTED,params.farMeshes!=0u||worldPlaced(placement))|select(0u,VSM_RENDER_CAND_FAR_CAST,(word&${MOBILITY_FAR_SHADOW}u)!=0u);
}
/** The centre of the row's whole object from the main view's eye. The object's sphere is the row's
 *  own (\`c\` centre high and radius, \`l\` centre low) moved by the offset and given the radius the
 *  rows pass wrote (\`lod.object\`, its offset then its radius); a row with no object, a radius of 0
 *  and an offset of 0, is judged by its own sphere. */
fn vsmRenderObjectDelta(c:vec4f,l:vec3f,lod:VsmRenderRowLod)->vec3f{
 return (c.xyz-params.eyeHigh)+(l-params.eyeLow)+lod.object.xyz;
}
/** The depth of the row's whole object along the main view, its radius taken off: what a sun's
 *  far-shadow test compares to its distance, all or nothing for every row of the object. */
fn vsmRenderFarDepth(c:vec4f,l:vec3f,lod:VsmRenderRowLod)->f32{
 return -dot(params.viewRow2.xyz,vsmRenderObjectDelta(c,l,lod))-select(c.w,lod.object.w,lod.object.w>0.0);
}
/** Whether the object of placement \`w\`, \`delta\` from the main view's eye (\`vsmRenderObjectDelta\`),
 *  is out of the draw distances it names — its mark's bit, then its two frame words — and casts
 *  nothing: a shadow is of what the view draws, from the main view's eye in every pass of the light.
 *  None when the parameters say no caster takes them (\`drawDistances\`). */
fn vsmRenderOutsideDrawDistance(w:u32,delta:vec3f)->bool{
 if(params.drawDistances==0u||(markOf(w)&${DRAW_DISTANCE_MARK}u)==0u){return false;}
 return outsideDrawDistances(dot(delta,delta),bitcast<f32>(framesWord(w,${DRAW_NEAR_WORD}u)),bitcast<f32>(framesWord(w,${DRAW_FAR_WORD}u)),params.viewDistanceScale);
}
/** Whether a row casts nothing into the pass: no corners, a sprite, a placement that casts no shadow,
 *  a row of the other kind — \`blend\` the blended casters the transmission takes, else the opaque
 *  ones —, or a row the camera cut's world switch does not draw (\`worldDraws\`, on its packed page
 *  and its placement): a world cluster whose cell hides its actor, a placement whose HLOD 0 cell
 *  draws none of its own — or a placement the main view's filter leaves out
 *  (\`vsmRenderFilteredOut\`). A shadow comes from what the view draws alone, a voxel row's as any. */
fn vsmRenderCasterSkipped(page:PageInfo,row:u32,blend:bool)->bool{
 return page.indexCount==0u||((page.flags&${FLAG_BLEND_CASTER}u)!=0u)!=blend||(page.flags&${FLAG_SPRITE}u)!=0u||(mobility[row]&${MOBILITY_SHADOWLESS}u)!=0u||!worldDraws(page.selectionIndex,page.placement)||vsmRenderFilteredOut(page.placement);
}
/** Appends the row's candidate when the main view's level of detail, residency folded, selects it,
 *  with the corners it draws: \`corners\` (its indices, twice for a two-sided row of the opaque raster,
 *  a voxel row's marked \`VSM_RENDER_VOXEL_BIT\`, the tier of its own it draws in,
 *  \`vsmRenderVs\`), and whether its faces turn: a mirroring placement (the main raster's
 *  \`windingCw\`) against a back-side row, which keeps its back faces (\`vsmRenderSwapped\`). */
fn vsmRenderAppendCandidate(row:u32,page:PageInfo,corners:u32){
 let lod=lods[row];
 let parentPixels=vsmRenderMainPixels(lod.parent,lod.parentLow,lod.radii.y);
 let ownPixels=vsmRenderMainPixels(lod.own,lod.ownLow,lod.radii.x);
 if(!drawsCluster(true,parentPixels,ownPixels,true,params.threshold)){return;}
 let s=spheres[row];
 if(vsmRenderOutsideDrawDistance(page.placement,vsmRenderObjectDelta(s.c,s.l.xyz,lod))){return;}
 let flipped=matrixWindingCw(page.world)!=((page.flags&${FLAG_BACK}u)!=0u);
 let word=mobility[row];
 let flags=vsmRenderCandidateFlags(word,page.deformOutput)|select(0u,VSM_RENDER_CAND_FLIPPED,flipped)|vsmRenderFarFlags(word,page.placement);
 // Out of every map view's far-shadow distance: no view takes it, no cull need read it.
 let farDepth=vsmRenderFarDepth(s.c,s.l.xyz,lod);
 if(vsmFarShadowSkipped(flags,farDepth,params.farDrop)){return;}
 let at=atomicAdd(&counts[0],1u);
 candidates[at]=VsmRenderCandidate(s.c,s.l.xyz,row,corners,flags,farDepth);
}`,
)

/** A candidates kernel: one thread a caster row, the opaque rows' (\`vsmRenderCandidates\`) or, with
 *  \`blend\`, the blended rows' of the frame's range (\`frame\`, \`transmissionClearWgsl.ts\`). */
export const vsmCandidatesKernel = (name: string, blend: boolean) => `
@compute @workgroup_size(WORKGROUP_THREADS) fn ${name}(@builtin(workgroup_id) wid:vec3u,@builtin(num_workgroups) nwg:vec3u,@builtin(local_invocation_index) lane:u32){
 let i=flatIndex(wid,nwg,1u)*WORKGROUP_THREADS+lane;
 if(i>=params.rowCount){return;}
 let row=${blend ? 'frame.rowFirst+i' : 'i'};
 let page=pages[row];
 if(vsmRenderCasterSkipped(page,row,${blend})){return;}
 vsmRenderAppendCandidate(row,page,${
   blend
     ? 'page.indexCount'
     : `select(page.indexCount,2u*page.indexCount,(page.flags&${FLAG_DOUBLE}u)!=0u)|select(0u,VSM_RENDER_VOXEL_BIT,(page.flags&${FLAG_VOXEL}u)!=0u)`
 });
}
`

/** The opaque caster rows the camera's cut selects (`VSM_RENDER_ROWS_WGSL`). */
export const vsmRenderCandidatesWgsl = () =>
  wgslProgram(vsmCandidatesKernel('vsmRenderCandidates', false), [
    VSM_RENDER_ROWS_WGSL,
    FLAT_INDEX_WGSL,
    WORKGROUP_THREADS_WGSL,
  ])
