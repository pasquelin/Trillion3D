import { CUT_RULE_WGSL } from '../page/cut/rule.ts'
import { FLOAT32_MAX } from '../../../math/src/wgsl/constants.ts'
import { FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL } from '../gpu/dispatch/grid.ts'
import { projectedBoundWgsl } from '../gpu/dag/shader/projectedBoundWgsl.ts'
import { MOBILITY_MOVING, MOBILITY_SHADOWLESS } from '../gpu/shadow/mobilityBits.ts'
import { PAGE_INFO_STRUCT_WGSL } from '../visibility/shader/pageWgsl.ts'
import { FLAG_BLEND_CASTER, FLAG_SPRITE } from '../visibility/types.ts'
import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import { wgslBlock, wgslConst } from '../../../math/src/wgsl/decl.ts'
import { VSM_RENDER_PARAMS_WGSL } from './renderParamsWgsl.ts'

/** THE NON-CLUSTER RASTER'S CASTER CANDIDATES (`renderCullWgsl.ts`): one thread a row, the rows the
 *  camera's cut selects appended with their sphere and flags. */

/** The render cull's `INF`, the bound `projectedBound` returns past the near plane: the greatest
 *  finite f32. */
const VSM_INF = wgslConst('INF', [FLOAT32_MAX], 'const INF:f32=FLOAT32_MAX;')

/**
 * What a candidates kernel reads of the caster rows — group 0: 0 params (uniform, dynamic), 1 page
 * table rows (`pages`), 2 row spheres, 3 row mobility words, 4 row levels of detail, 5
 * candidates (rw), 6 counters (rw atomic) — and the main view's pixels of a row's error: the
 * opaque rows' (`vsmRenderCandidatesWgsl`) and the blended rows' (`transmissionWgsl.ts`).
 */
export const VSM_RENDER_ROWS_WGSL = wgslBlock(
  'VSM_RENDER_ROWS_WGSL',
  [PAGE_INFO_STRUCT_WGSL, VSM_RENDER_PARAMS_WGSL, projectedBoundWgsl(VSM_INF), CUT_RULE_WGSL],
  `
struct VsmRenderSphere{c:vec4f,l:vec4f,}
struct VsmRenderRowLod{own:vec4f,parent:vec4f,ownLow:vec4f,parentLow:vec4f,radii:vec4f,}
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
/** Whether a row casts nothing into the pass: no corners, a sprite, a placement that casts no shadow,
 *  or a row of the other kind — \`blend\` the blended casters the transmission takes, else the opaque ones. */
fn vsmRenderCasterSkipped(page:PageInfo,row:u32,blend:bool)->bool{
 return page.indexCount==0u||((page.flags&${FLAG_BLEND_CASTER}u)!=0u)!=blend||(page.flags&${FLAG_SPRITE}u)!=0u||(mobility[row]&${MOBILITY_SHADOWLESS}u)!=0u;
}
/** Appends the row's candidate when the main view's level of detail, residency folded, selects it;
 *  \`objectKnown\` carries the radius of its whole object (0, the row's sphere standing in, else). */
fn vsmRenderAppendCandidate(row:u32,page:PageInfo,objectKnown:bool){
 let lod=lods[row];
 let parentPixels=vsmRenderMainPixels(lod.parent,lod.parentLow,lod.radii.y);
 let ownPixels=vsmRenderMainPixels(lod.own,lod.ownLow,lod.radii.x);
 if(!drawsCluster(true,parentPixels,ownPixels,true,params.threshold)){return;}
 let s=spheres[row];
 let flags=vsmRenderCandidateFlags(mobility[row],page.deformOutput);
 let at=atomicAdd(&counts[0],1u);
 candidates[at]=VsmRenderCandidate(s.c,s.l.xyz,row,page.indexCount,flags,select(0u,bitcast<u32>(lod.radii.z),objectKnown),0u);
}`,
)

/** A candidates kernel: one thread a caster row, the opaque rows' (\`vsmRenderCandidates\`) or, with
 *  \`blend\`, the blended rows' of the frame's range (\`frame\`, \`transmissionWgsl.ts\`). */
export const vsmCandidatesKernel = (name: string, blend: boolean) => `
@compute @workgroup_size(WORKGROUP_THREADS) fn ${name}(@builtin(workgroup_id) wid:vec3u,@builtin(num_workgroups) nwg:vec3u,@builtin(local_invocation_index) lane:u32){
 let i=flatIndex(wid,nwg,1u)*WORKGROUP_THREADS+lane;
 if(i>=params.rowCount){return;}
 let row=${blend ? 'frame.rowFirst+i' : 'i'};
 let page=pages[row];
 if(vsmRenderCasterSkipped(page,row,${blend})){return;}
 vsmRenderAppendCandidate(row,page,${!blend});
}
`

/** The opaque caster rows the camera's cut selects (`VSM_RENDER_ROWS_WGSL`). */
export const vsmRenderCandidatesWgsl = () =>
  wgslProgram(vsmCandidatesKernel('vsmRenderCandidates', false), [
    VSM_RENDER_ROWS_WGSL,
    FLAT_INDEX_WGSL,
    WORKGROUP_THREADS_WGSL,
  ])
