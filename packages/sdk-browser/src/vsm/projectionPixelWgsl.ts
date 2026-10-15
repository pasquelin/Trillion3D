/**
 * The projection's per-pixel pieces (`projectionWgsl.ts`): the votes of a group's 32-pixel halves,
 * and a pixel's reconstruction from the depth with its surface's shading info.
 */
import { AS_IS_FLAG, SURFACE_MODEL_MASK } from '../scene/surfaceModel.ts'
import { SUBSURFACE_FLAG } from '../scene/subsurface.ts'

/** Whether both halves voted true (`halfVoted`: the lane's half's vote), one answer for the
 *  group: a word a half, written after a barrier every lane passes once it has read the last ones. */
const GROUP_VOTED = /* wgsl */ `
var<workgroup> vsmHalfVoted:vec2u;
fn vsmGroupVoted(halfVoted:bool)->bool{
 workgroupBarrier();
 if(vsmLaneInHalf==0u){vsmHalfVoted[vsmLaneHalf]=select(0u,1u,halfVoted);}
 return all(workgroupUniformLoad(&vsmHalfVoted)==vec2u(1u));
}`
/**
 * The votes. AllTrue over the lane's 32-pixel half; callers pass `c || !active` so a lane outside
 * the vote holds it true. Must be reached in uniform control flow. A workgroup counter of "false"
 * votes per half: slot (call % 3) × half. A call clears the previous call's slot after its barrier,
 * which every reader of that slot has passed, and before the barrier of the next call, which every
 * writer of it (two calls later) has to pass. Zero-initialised by WebGPU. And the group's answer
 * (`GROUP_VOTED`).
 */
export const VSM_PROJECTION_VOTE_WGSL = /* wgsl */ `
var<workgroup> vsmVoteFalse:array<atomic<u32>,6>;
var<private> vsmVoteSerial:u32;
var<private> vsmLaneHalf:u32;
var<private> vsmLaneInHalf:u32;
fn vsmLaneInit(groupIndex:u32){vsmLaneHalf=groupIndex>>5u;vsmLaneInHalf=groupIndex&31u;vsmVoteSerial=0u;}
fn vsmVoteAllTrue(c:bool)->bool{
 let slot=vsmVoteSerial%3u;
 vsmVoteSerial+=1u;
 if(!c){atomicAdd(&vsmVoteFalse[slot*2u+vsmLaneHalf],1u);}
 workgroupBarrier();
 let r=atomicLoad(&vsmVoteFalse[slot*2u+vsmLaneHalf])==0u;
 if(vsmLaneInHalf==0u){atomicStore(&vsmVoteFalse[((slot+2u)%3u)*2u+vsmLaneHalf],0u);}
 return r;
}
${GROUP_VOTED}
`

/** Pixel reconstruction from the depth, and the surface's shading info. */
export const VSM_PROJECTION_PIXEL_WGSL = /* wgsl */ `
fn vsmUnpackEvenBits(xIn:u32)->u32{
 var x=xIn&0x55555555u;
 x=(x^(x>>1u))&0x33333333u;
 x=(x^(x>>2u))&0x0f0f0f0fu;
 x=(x^(x>>4u))&0x00ff00ffu;
 x=(x^(x>>8u))&0x0000ffffu;
 return x;
}
/** The 2D coordinates of a Z-order index: its even bits and its odd bits. */
fn vsmZOrderDecode(m:u32)->vec2u{return vec2u(vsmUnpackEvenBits(m),vsmUnpackEvenBits(m>>1u));}
/** A fragment's shifted position (projection rect = view rect). */
fn vsmPixelToShifted(sv:vec4f)->vec3f{
 let p=(sv.xy-vec2f(vsmView.projectionRect.xy))*vsmView.viewPixels.zw;
 return unprojectPoint(vsmView.clipToShifted,vec3f(uvToNdc(p),sv.z));
}
/** The shading info of a pixel, from this engine's surface buffers: \`valid\` where a light can
 *  shade it — in the view rect, a lit surface model —, the one pixel whose normal is taken. */
fn vsmSurfaceOf(coord:vec2u,inRect:bool,normal:vec3f)->VsmSurfaceInfo{
 let flag=textureLoad(vsmFlags,coord,0).r;
 let model=flag&${SURFACE_MODEL_MASK}u;
 var r:VsmSurfaceInfo;
 r.valid=inRect&&!(model<=1u||model==${AS_IS_FLAG}u);
 r.subsurface=(flag&${SUBSURFACE_FLAG}u)!=0u;
 if(r.valid){r.worldNormal=normalize(normal);}
 r.biasNormal=r.worldNormal;
 return r;
}
`
