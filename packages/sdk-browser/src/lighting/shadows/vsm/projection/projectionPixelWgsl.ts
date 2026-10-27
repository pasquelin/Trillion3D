/**
 * The projection's per-pixel pieces (`projectionWgsl.ts`): the votes of a group's 32-pixel halves,
 * a pixel's reconstruction from the depth, and the opaque surfaces' pieces of it.
 */
import { AS_IS_FLAG, SURFACE_MODEL_MASK } from '../../../../materials/surface/surfaceModelWord.ts'
import { PHYSICAL_SURFACE_FLAG } from '../../../../materials/surface/physicalLobes.ts'
import { PIXEL_MODEL } from '../../../../materials/surface/pixelModel.ts'

/** A projection group's half, which votes as one: its lanes (32, Z-order indices 0-31, 32-63) and
 *  their log2. */
const VSM_PROJECTION_HALF_SHIFT = 5
export const VSM_PROJECTION_HALF_LANES = 1 << VSM_PROJECTION_HALF_SHIFT

/** Whether both halves voted true (`halfVoted`: the lane's half's vote), one answer for the
 *  group: a word a half, written after a barrier every lane passes once it has read the last ones. */
const GROUP_VOTED = /* wgsl */ `
var<workgroup> vsmHalfVoted:vec2u;
fn vsmGroupVoted(halfVoted:bool)->bool{
 workgroupBarrier();
 if(vsmLaneInHalf==0u){vsmHalfVoted[vsmLaneHalf]=select(0u,1u,halfVoted);}
 return all(workgroupUniformLoad(&vsmHalfVoted)==vec2u(1u));
}`
/** The workgroup counters' vote (`vsmProjectionVoteWgsl`): a counter of "false" votes per half, slot
 *  (call % 3) × half. A call clears the previous call's slot after its barrier, which every reader
 *  of that slot has passed, and before the barrier of the next call, which every writer of it (two
 *  calls later) has to pass. Zero-initialised by WebGPU. */
const COUNTER_VOTE = /* wgsl */ `var<workgroup> vsmVoteFalse:array<atomic<u32>,6>;
var<private> vsmVoteSerial:u32;
fn vsmVoteAllTrue(c:bool)->bool{
 let slot=vsmVoteSerial%3u;
 vsmVoteSerial+=1u;
 if(!c){atomicAdd(&vsmVoteFalse[slot*2u+vsmLaneHalf],1u);}
 workgroupBarrier();
 let r=atomicLoad(&vsmVoteFalse[slot*2u+vsmLaneHalf])==0u;
 if(vsmLaneInHalf==0u){atomicStore(&vsmVoteFalse[((slot+2u)%3u)*2u+vsmLaneHalf],0u);}
 return r;
}`
/**
 * The votes. AllTrue over the lane's half (`VSM_PROJECTION_HALF_LANES`); callers pass `c || !active`
 * so a lane outside the vote holds it true. Must be reached in uniform control flow. By workgroup
 * counters (`COUNTER_VOTE`), or with `subgroups` — a device whose every subgroup holds a half's
 * lanes (`hasSubgroupsOf`), lanes 0-31 and 32-63 of the group — by the half's subgroup
 * (`subgroupAllTrue`, `SUBGROUP_ALL_WGSL`, which the module lists), no barrier. And the group's
 * answer (`GROUP_VOTED`).
 */
export const vsmProjectionVoteWgsl = (subgroups: boolean) => /* wgsl */ `
var<private> vsmLaneHalf:u32;
var<private> vsmLaneInHalf:u32;
fn vsmLaneInit(groupIndex:u32){vsmLaneHalf=groupIndex>>${VSM_PROJECTION_HALF_SHIFT}u;vsmLaneInHalf=groupIndex&${VSM_PROJECTION_HALF_LANES - 1}u;${subgroups ? '' : 'vsmVoteSerial=0u;'}}
${subgroups ? 'fn vsmVoteAllTrue(c:bool)->bool{return subgroupAllTrue(c);}' : COUNTER_VOTE}
${GROUP_VOTED}
`

/** Pixel reconstruction from the depth. */
export const VSM_PROJECTION_PIXEL_WGSL = /* wgsl */ `
/** A fragment's shifted position (projection rect = view rect). */
fn vsmPixelToShifted(sv:vec4f)->vec3f{
 let p=(sv.xy-vec2f(vsmView.projectionRect.xy))*vsmView.viewPixels.zw;
 return unprojectPoint(vsmView.clipToShifted,vec3f(uvToNdc(p),sv.z));
}
`

/** The opaque surfaces' piece of a pixel (`vsmPixelOf`): the shading info from the surface
 *  buffers — `valid` where a light can shade it: in the view rect, a lit surface model —, whose
 *  normal the normal bias and the receiver's depth slope follow. A pixel is clear-coated where its
 *  coat factor of its lobes texel is above zero
 *  (\`packedCoat\`; a cloth's texel holds none), the closest per-pixel form of the clear-coat shading
 *  model, whose pixels the projection does not back-face cull. */
export const VSM_PROJECTION_OPAQUE_WGSL = /* wgsl */ `
fn vsmCoatedAt(coord:vec2u,flag:u32)->bool{
 return (flag&${PHYSICAL_SURFACE_FLAG}u)!=0u&&packedCoat(textureLoad(vsmLobes,coord)).x>0.0;
}
fn vsmSurfaceOf(coord:vec2u,inRect:bool,normal:vec3f)->VsmSurfaceInfo{
 let flag=textureLoad(vsmFlags,coord,0).r;
 let model=flag&${SURFACE_MODEL_MASK}u;
 var r:VsmSurfaceInfo;
 r.valid=inRect&&!(model<=1u||model==${AS_IS_FLAG}u);
 r.subsurface=vsmSubsurfaceModel(flag);
 r.coated=vsmCoatedAt(coord,flag);
 r.hair=pixelModelOf(flag)==${PIXEL_MODEL.hair}u;
 // A receiver that lets light through its shadow: its opacity, at most 0.99 — it never stops the light
 // whole —, the thin transmission's or the skin's, both in the target's alpha.
 r.opacity=select(-1.0,min(textureLoad(subsurfaceColor,vec2i(coord)).a,0.99),vsmTransmitsShadow(flag));
 r.firstPerson=isFirstPerson(flag);
 if(r.valid){r.worldNormal=normalize(normal);}
 return r;
}
`
