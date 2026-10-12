/**
 * The virtual shadow map projection compute pass: the per-pixel light projection and its
 * directional and local light traces, with the screen ray trace, the sample filter and the pieces
 * of the projection common helpers listed in `traceWgsl.ts`.
 *
 * DISPATCH. 8×8 groups, pixels in Z-order inside a group (group index → Z-order decode),
 * 32-lane waves. The wave votes of the adaptive ray count (all true) and of the point-light face
 * test (any true) therefore act on 32-pixel 8×4 halves of a group (Z-order indices 0-31, 32-63).
 * Two variants from this one source, chosen from `device.features` (`voteWgsl`):
 * - `subgroups`: a subgroupAny per half a vote, at any subgroup size where a half lies in one
 *   subgroup, the workgroup counter where one does not;
 * - fallback: a workgroup counter per half (3 rotating slots, one barrier per vote).
 * Same image either way. A thread never leaves alone (the early return past the rect, the per-ray
 * `break`): every loop that votes has a uniform bound (uniform buffer values), a thread out of the
 * rect / out of the light / whose half has voted to stop keeps iterating as a no-op and votes
 * neutrally (true for all-true, false for any-true), exactly the lanes a wave excludes. The whole
 * group leaves a ray loop at once, where both its halves voted to stop (`vsmGroupVoted`).
 *
 * LIGHTS. Every shadowed light of the frame in one dispatch, up to 64 (`vsmView.lights`): light k
 * is the 8-bit lane k % 4 of the r32uint mask's layer k / 4 — the k of n rays its trace counted
 * missing (`vsmMaskCode`, decoded by `vsmMaskDecode`, `lighting/direct/shadowWgsl.ts`), 0 (= 1, lit) for the unused lanes
 * of the last layer —, each pixel's inputs read and reconstructed once for all of them. Each light
 * takes its own kind's trace; a pass of one kind, or of one light, runs a pipeline specialised to
 * it (`VSM_PROJECTION_KINDS`, `VSM_PROJECTION_ONE_LIGHT`).
 *
 * TILES. A group's 8×8 pixels are a tile, and its work follows the lights that reach it, never the
 * frame's count: each lane bounds its lit pixel's point into the tile's box, lane k tests light k
 * against that box (`vsmLightMayReachTile`, conservative), each pixel runs the exact region test
 * (`vsmLightParticipates`) on those candidates alone, and the tile's lights are those a pixel of it
 * is in — the very set a test of every light at every pixel gives. Only a layer holding one of
 * them is stored, and the layers stored go to the tile's word (`vsmShadowMaskTiles`): the resolve
 * reads a light's lane only where its tile stored its layer (`vsmMaskFactor`,
 * `lighting/direct/shadowWgsl.ts`), every other lane being 0, its factor 1. A pixel no light
 * shades (sky, unlit, out of the rect) reads its flags and stops there: it reconstructs nothing,
 * takes no noise and decodes no receiver.
 * The lights are those of the frame's plan, not the light grid's cells: the projection's point is
 * the receiver's (`shadowReceiver`), off the depth a cell's list was built for. A thin-subsurface
 * pixel gets no normal bias, no screen ray, no back-face cull.
 */
import { AS_IS_FLAG, SURFACE_MODEL_MASK } from '../scene/surfaceModel.ts'
import { SUBSURFACE_FLAG } from '../scene/subsurface.ts'
import { receiverTargetReadWgsl } from '../visibility/shader/receiverTargetWgsl.ts'
import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import {
  bitIsSet,
  bitMask,
  bitWord,
  ceilDiv as ceilDivWgsl,
  isFiniteWord,
  lowBits,
} from '../../../math/src/wgsl/integer.ts'
import { FLOAT32_MIN_NORMAL } from '../../../math/src/wgsl/constants.ts'
import { clipToFramebuffer, unprojectPoint, uvToNdc } from '../../../math/src/wgsl/projection.ts'
import { SCREEN_MARCH_WGSL } from '../gpu/hiz/screenMarch.ts'
import { vsmBlueNoiseTwo, vsmBlueNoiseWgsl } from './blueNoise.ts'
import { VSM_CONSTANTS_WGSL } from './constants.ts'
import { VSM_PROJECTION_MAX_PASS_LIGHTS, VSM_PROJECTION_VIEW_STRUCT } from './projectionView.ts'
import { VSM_PROJECTION_DATA_WGSL } from './projectionDataWgsl.ts'
import { vsmBindingsWgsl, type VsmBindingSpec, vsmPoolLoadOf } from './resources.ts'
import {
  VSM_TRACE_RESULT_WGSL,
  VSM_TRACE_COMMON_WGSL,
  VSM_TRACE_LIGHT_WGSL,
  vsmTraceWgsl,
} from './traceWgsl.ts'
import type { VsmLayout } from './layout.ts'
import { localLightReaches } from '../lighting/direct/lightWgsl.ts'
import { ceilDiv } from '../../../math/src/scalar/integers.ts'

/** Pixels a side of a projection group, a tile of the mask's tile words: 8, a power of two. */
export const VSM_PROJECTION_GROUP_SHIFT = 3
export const VSM_PROJECTION_GROUP_SIZE = 1 << VSM_PROJECTION_GROUP_SHIFT
/** The projection's groups, a tile word each, along `pixels`. */
export const vsmProjectionGroups = (pixels: number) => ceilDiv(pixels, VSM_PROJECTION_GROUP_SIZE)
/** The projection's groups over `width` × `height` pixels. */
export const vsmProjectionTiles = (width: number, height: number) =>
  [vsmProjectionGroups(width), vsmProjectionGroups(height)] as const
/** Lights per layer of the mask: four 8-bit lanes of an r32uint texel. */
export const VSM_PROJECTION_MAX_LIGHTS = 4
/** Mask format: four lights' 8-bit lanes (`vsmMaskCode`). */
export const VSM_PROJECTION_MASK_FORMAT: GPUTextureFormat = 'r32uint'
/** Format of the mask's tile words: a texel per group, bit L where the group stored layer L. */
export const VSM_PROJECTION_TILE_FORMAT: GPUTextureFormat = 'r32uint'
/** Bits of `VSM_PROJECTION_KINDS`: a directional light in the pass, a local one. */
export const VSM_PROJECTION_KINDS_DIRECTIONAL = 1
export const VSM_PROJECTION_KINDS_LOCAL = 2

/** Group 0: the VSM tables the projection reads (bindings 4.. = the pool, slices × parts). */
export const VSM_PROJECTION_VSM_SPECS: readonly VsmBindingSpec[] = [
  { resource: 'uniforms', binding: 0 },
  { resource: 'pageTable', binding: 1 },
  { resource: 'projectionData', binding: 2 },
  { resource: 'tileDepths', binding: 3 },
  { resource: 'pagePool', binding: 4 },
]

/** Group 1 bindings. */
export const VSM_PROJECTION_BINDING = {
  view: 0,
  sceneDepth: 1,
  normalRough: 2,
  flags: 3,
  blueNoise: 4,
  shadowMask: 5,
  shadowMaskTiles: 6,
  /** The depth pyramid: four bindings from here (`hizDepthEntries`). */
  hizDepth: 7,
} as const

/** Bind group of the shadow receiver target the resolve wrote (`receiverTargetWgsl.ts`), binding 0. */
export const VSM_PROJECTION_RECEIVER_GROUP = 2

/** The view uniform and the light kind the lights' records carry (`projectionView.ts`). */
const PROJECTION_VIEW = /* wgsl */ `
${VSM_PROJECTION_VIEW_STRUCT}
`

const bindingsWgsl = () => {
  const B = VSM_PROJECTION_BINDING
  return /* wgsl */ `
@group(1) @binding(${B.view}) var<uniform> vsmView:VsmProjectionView;
@group(1) @binding(${B.sceneDepth}) var vsmSceneDepth:texture_depth_2d;
@group(1) @binding(${B.normalRough}) var vsmNormalRough:texture_2d<f32>;
@group(1) @binding(${B.flags}) var vsmFlags:texture_2d<u32>;
@group(1) @binding(${B.shadowMask}) var vsmShadowMask:texture_storage_2d_array<${VSM_PROJECTION_MASK_FORMAT},write>;
@group(1) @binding(${B.shadowMaskTiles}) var vsmShadowMaskTiles:texture_storage_2d<${VSM_PROJECTION_TILE_FORMAT},write>;`
}

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
 * The wave votes. AllTrue over the lane's 32-pixel half; callers pass `c || !active` so a lane
 * outside the vote holds it true. Must be reached in uniform control flow, `split`
 * uniform (`vsmLaneInit`'s word, read by `workgroupUniformLoad`).
 * - A workgroup counter per half (3 rotating slots, one barrier per vote): exact whatever the
 *   subgroups, the only vote without them.
 * - With subgroups, where each half lies in one subgroup — whatever its size and its lanes' order,
 *   counted by `vsmLaneInit`'s two ballots —, a half is all true when its subgroup holds no lane of
 *   it voting false: one subgroupAny a half. Where a half does not (a subgroup under 32 lanes),
 *   `split` holds for the whole group and every vote takes the counter.
 * And the group's answer (`GROUP_VOTED`).
 */
const voteWgsl = (subgroups: boolean) => /* wgsl */ `
/** Counters of "false" votes: slot (call % 3) × half. A call clears the previous call's slot after
 *  its barrier, which every reader of that slot has passed, and before the barrier of the next
 *  call, which every writer of it (two calls later) has to pass. Zero-initialised by WebGPU. */
var<workgroup> vsmVoteFalse:array<atomic<u32>,6>;
var<private> vsmVoteSerial:u32;
var<private> vsmLaneHalf:u32;
var<private> vsmLaneInHalf:u32;
fn vsmVoteCounter(c:bool)->bool{
 let slot=vsmVoteSerial%3u;
 vsmVoteSerial+=1u;
 if(!c){atomicAdd(&vsmVoteFalse[slot*2u+vsmLaneHalf],1u);}
 workgroupBarrier();
 let r=atomicLoad(&vsmVoteFalse[slot*2u+vsmLaneHalf])==0u;
 if(vsmLaneInHalf==0u){atomicStore(&vsmVoteFalse[((slot+2u)%3u)*2u+vsmLaneHalf],0u);}
 return r;
}
${GROUP_VOTED}${
  subgroups
    ? `/** Non-zero where a half reaches past one subgroup. Zero-initialised by WebGPU. */
var<workgroup> vsmVoteSplit:atomic<u32>;
fn vsmLaneInit(groupIndex:u32){
 vsmLaneHalf=groupIndex>>5u;vsmLaneInHalf=groupIndex&31u;vsmVoteSerial=0u;
 // The lanes of each half in this lane's subgroup. A half that reaches past one subgroup has
 // under 32 in each: its first lane speaks for it.
 let first=countOneBits(subgroupBallot(vsmLaneHalf==0u));
 let second=countOneBits(subgroupBallot(vsmLaneHalf==1u));
 let n=select(first,second,vsmLaneHalf==1u);
 if(vsmLaneInHalf==0u&&n.x+n.y+n.z+n.w!=32u){atomicOr(&vsmVoteSplit,1u);}
}
fn vsmVoteAllTrue(c:bool,split:bool)->bool{
 if(split){return vsmVoteCounter(c);}
 let first=subgroupAny(!c&&vsmLaneHalf==0u);
 let second=subgroupAny(!c&&vsmLaneHalf==1u);
 return !select(first,second,vsmLaneHalf==1u);
}`
    : `fn vsmLaneInit(groupIndex:u32){vsmLaneHalf=groupIndex>>5u;vsmLaneInHalf=groupIndex&31u;vsmVoteSerial=0u;}
fn vsmVoteAllTrue(c:bool,split:bool)->bool{return vsmVoteCounter(c);}`
}
`

/** Pixel reconstruction, normal bias, screen ray, filter. */
const PIXEL_WGSL = /* wgsl */ `
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
/** The distance to the camera from a view vector (along the view axis for an orthographic view). */
fn vsmCameraDistance(v:vec3f)->f32{
 var d=length(v);
 if(vsmView.isOrtho!=0u){d*=d/dot(v,vsmView.viewForward);}
 return d;
}
/** The normal bias length at a position (0.02 cm floor = VSM_NORMAL_OFFSET_FLOOR). */
fn vsmNormalOffset(shiftedPosition:vec3f)->f32{
 let distanceToCamera=vsmCameraDistance(shiftedPosition-vsmView.shiftedEye);
 return vsmNormalOffsetLength(vsm.normalBias,distanceToCamera,vsmView.halfFovTangents.z);
}
/** The screen-space ray cast: the engine's screen march (\`screenMarch\`, \`gpu/hiz/screenMarch.ts\`)
 *  of the depth along the ray's length, whose reach is the ray's own and whose thickness is
 *  \`thickness\` pixels of footprint — the ray's depth span, so that a surface nearer than the ray
 *  by more than it spans is no occluder of the point the ray leaves. The first crossing is the
 *  occluder: the ray's length up to it, a pixel and a half back (declared: the map trace starts
 *  at the surface, never behind it), or the whole length where it meets nothing. */
fn vsmScreenRayCast(rayOrigin:vec3f,rayDirection:vec3f,rayLength:f32,thickness:f32)->f32{
 let size=vsmView.viewPixels.xy;
 let start=clipToFramebuffer(vsmView.shiftedToClip*vec4f(rayOrigin,1.0),size);
 let stop=clipToFramebuffer(vsmView.shiftedToClip*vec4f(rayOrigin+rayDirection*rayLength,1.0),size);
 let d=stop-start;
 let hit=screenMarch(start,d,screenMarchEnd(start.xy,d.xy,size),thickness,vsmView.screenSlab);
 // A transparent surface is no occluder here: the maps' transmission is its shadow.
 if(hit.t<0.0||hit.front){return rayLength;}
 return rayLength*max(0.0,hit.t-1.5/max(max(abs(d.x),abs(d.y)),1e-6));
}
/** \`biasNormal\`: the normal the receiver's biases follow (normal bias, receiver-plane depth slope);
 *  the shading normal unless the engine's shadow receiver gives its triangle's plane. */
struct VsmSurfaceInfo{valid:bool,subsurface:bool,worldNormal:vec3f,biasNormal:vec3f,}
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
/** What a pixel of the group brings to its lights: its position, whether it is in the view rect
 *  and its shading info; where a light can shade it (\`info.valid\`), its view depth, its shifted
 *  point on the receiver, its screen ray length and its blue noise — zero elsewhere, where no
 *  light reads them (\`vsmLightParticipates\`, the traces' \`participating\`). */
struct VsmPixel{pos:vec2u,inRect:bool,info:VsmSurfaceInfo,sceneDepth:f32,shifted:vec3f,screenRayWorld:f32,noise:f32,}
`

/** The traces, with the votes of the compute groups, then the light's region and projection. */
const traceWgsl =
  () => /* wgsl */ `/** The kinds of the pass's lights, set by the pass (\`pipelineFor\`, \`projectionPass.ts\`): a directional light,
 *  a local one, or both (any other value). A pass of one kind is compiled with that kind's trace alone: the
 *  other kind's code, and the registers its peak holds, are not in it. The same light either way. */
override VSM_PROJECTION_KINDS:u32=0u;
fn vsmLightIsDirectional(light:VsmProjectionLight)->bool{
 let kinds=VSM_PROJECTION_KINDS;
 return kinds==${VSM_PROJECTION_KINDS_DIRECTIONAL}u||(kinds!=${VSM_PROJECTION_KINDS_LOCAL}u&&light.kind==LIGHT_KIND_DIRECTIONAL);
}
/** The region test: whether light k shades the pixel at all (in the view rect, a lit surface,
 *  where the lighting gives the light energy — \`localLightReaches\` —, not back-facing). */
fn vsmLightParticipates(k:u32,info:VsmSurfaceInfo,shiftedPositionIn:vec3f)->bool{
 if(!info.valid){return false;}
 let light=vsmView.lights[k];
 let backfaceCull=!info.subsurface;
 if(vsmLightIsDirectional(light)){
  return !(backfaceCull&&vsmFacesAwayFromSun(info.worldNormal,light.direction,light.sourceRadius));
 }
 let toLight=light.shiftedPosition-shiftedPositionIn;
 if(!localLightReaches(toLight,light.radius,light.cosCone,-light.direction,light.kind==LIGHT_KIND_RECT)){return false;}
 return !(backfaceCull&&vsmFacesAwayFromLocal(toLight,info.worldNormal,light.sourceRadius));
}
/** \`vsmLightParticipates\`'s radius test widened: a light whose sphere is this much larger misses
 *  the tile's box. 1/64 past the roundings of either test (a few units in the last place). */
const VSM_TILE_REACH:f32=1.015625;
/**
 * Whether light k may shade a pixel of a tile whose lit pixels' points lie in the box [\`low\`,
 * \`high\`]: never false where \`vsmLightParticipates\` is true at one of those points. Every light
 * may reach a tile one of whose lit points is not finite (\`unbounded\`), whose test WGSL leaves
 * to the device, and a directional light any tile; a local light is tested on its sphere alone,
 * the cone and the faces left to the pixels. The box's nearest point is no farther from the
 * centre than any of its pixels, axis by axis: a subtraction is correctly rounded, hence
 * monotonic, so each axis's difference is at most the pixel's own, exactly; the squared distances
 * — a pixel's, against its range squared — and the box's square root then round within a few
 * units in the last place, which the reach's 1/64 holds many times over. A box whose squared
 * distance to the centre is under the smallest normal f32 (\`FLOAT32_MIN_NORMAL\`) holds it,
 * whatever the device does with subnormals.
 */
fn vsmLightMayReachTile(k:u32,low:vec3f,high:vec3f,unbounded:bool)->bool{
 let light=vsmView.lights[k];
 if(unbounded||vsmLightIsDirectional(light)){return true;}
 let c=light.shiftedPosition;
 let d=max(max(low-c,c-high),vec3f(0.0));
 let g=dot(d,d);
 return g<FLOAT32_MIN_NORMAL||sqrt(g)<=light.radius*VSM_TILE_REACH;
}
/** Light k's 8-bit lane: 0 where no ray was traced (its factor 1), else its rays n (high nibble,
 *  n ≤ 15) and the k of them that missed (low nibble), recovered exactly from k/n: the division's
 *  error times n ≤ 15 stays far under a half. Decoded by \`vsmMaskDecode\` (\`lighting/direct/shadowWgsl.ts\`). */
fn vsmMaskCode(r:VsmTraceResult)->u32{
 if(r.rayCount==0u){return 0u;}
 return (r.rayCount<<4u)|u32(round(r.shadowFactor*f32(r.rayCount)));
}
/** Projects light k onto a pixel (pass-per-light inputs: the light and its map id). */
fn vsmProjectLight(k:u32,pixel:VsmPixel,participating:bool,voteSplit:bool)->VsmTraceResult{
 let light=vsmView.lights[k];
 let info=pixel.info;
 let directional=vsmLightIsDirectional(light);
 let toLight=light.shiftedPosition-pixel.shifted;
 let L=select(toLight*inverseSqrt(dot(toLight,toLight)),light.direction,directional);
 let worldNormal=info.biasNormal;
 var shiftedPosition=pixel.shifted;
 var traceStart=pixel.screenRayWorld;
 if(participating){
  if(!info.subsurface){shiftedPosition+=worldNormal*vsmNormalOffset(shiftedPosition);}
  if(!info.subsurface&&pixel.screenRayWorld>0.0){
   traceStart=vsmScreenRayCast(shiftedPosition,L,pixel.screenRayWorld,pixel.screenRayWorld/vsmPixelWorldSize(pixel.sceneDepth,vsmView.viewToClip,vsmView.viewPixels.xy));
  }
 }
 if(directional){
  return vsmTraceSun(light.mapId,light,pixel.pos,shiftedPosition,traceStart,pixel.noise,worldNormal,participating,voteSplit);
 }else{
  return vsmTraceLocal(light.mapId,light,pixel.pos,pixel.sceneDepth,shiftedPosition,traceStart,pixel.noise,worldNormal,participating,voteSplit);
 }
}
`

/**
 * The tile's box (`vsmLightMayReachTile`): each lit pixel's point, a coordinate's order kept by its
 * key (`vsmOrderedKey`), joined by the greatest key — and the greatest of the keys' complements,
 * whence the least — over the group; `vsmTileHeld` has bit 0 where a pixel is lit, bit 1 where one
 * of them is at a point not finite. With subgroups a subgroup joins its lanes first, one lane of it
 * joining the group's.
 */
const tileBoundWgsl = (subgroups: boolean) => /* wgsl */ `
/** The tile's greatest keys of x, y and z, then of their complements. Zero-initialised by WebGPU,
 *  as are \`vsmTileHeld\` and the light words. */
var<workgroup> vsmTileBounds:array<atomic<u32>,6>;
var<workgroup> vsmTileHeld:atomic<u32>;
/** The lights that may reach the tile (\`vsmLightMayReachTile\`), 32 a word. */
var<workgroup> vsmTileCandidates:array<atomic<u32>,2>;
/** A float's key: its order as an unsigned integer (the sign bit set on a positive float, every
 *  bit flipped on a negative one), and back. */
fn vsmOrderedKey(x:vec3f)->vec3u{
 let u=bitcast<vec3u>(x);
 return select(u|vec3u(0x80000000u),~u,(u&vec3u(0x80000000u))!=vec3u(0u));
}
fn vsmOrderedValue(k:vec3u)->vec3f{
 return bitcast<vec3f>(select(~k,k&vec3u(0x7fffffffu),(k&vec3u(0x80000000u))!=vec3u(0u)));
}
/** Joins a pixel's point to the tile's box where it is lit (\`valid\`); \`lane\` is its rank in its
 *  subgroup, read with subgroups only. Its \`held\` is 0, 1 or 3: their greatest is their union.
 *  Reached in uniform flow. */
fn vsmTileBound(valid:bool,p:vec3f,lane:u32){
 let finite=isFiniteWord(bitcast<u32>(p.x))&&isFiniteWord(bitcast<u32>(p.y))&&isFiniteWord(bitcast<u32>(p.z));
 var held=0u;var high=vec3u(0u);var low=vec3u(0u);
 if(valid){
  held=select(3u,1u,finite);
  if(finite){high=vsmOrderedKey(p);low=~high;}
 }${
   subgroups
     ? `
 held=subgroupMax(held);high=subgroupMax(high);low=subgroupMax(low);
 if(lane!=0u||held==0u){return;}`
     : `
 if(held==0u){return;}`
 }
 atomicOr(&vsmTileHeld,held);
 for(var i=0u;i<3u;i++){atomicMax(&vsmTileBounds[i],high[i]);atomicMax(&vsmTileBounds[3u+i],low[i]);}
}
/** The lights 0 to \`count\` − 1, 32 a word (\`count\` ≤ 64). */
fn vsmLightsBelow(count:u32)->vec2u{
 let low=select(0xffffffffu,lowBits(count),count<32u);
 let high=select(select(0u,lowBits(count-32u),count>32u),0xffffffffu,count>=64u);
 return vec2u(low,high);
}
/** Lane k's light k, once every lane joined the box: a candidate of the tile where it may reach it. */
fn vsmTileCandidate(k:u32,lightCount:u32){
 let held=atomicLoad(&vsmTileHeld);
 if(k>=lightCount||held==0u){return;}
 var high=vec3u(0u);var low=vec3u(0u);
 for(var i=0u;i<3u;i++){high[i]=atomicLoad(&vsmTileBounds[i]);low[i]=~atomicLoad(&vsmTileBounds[3u+i]);}
 if(vsmLightMayReachTile(k,vsmOrderedValue(low),vsmOrderedValue(high),(held&2u)!=0u)){atomicOr(&vsmTileCandidates[bitWord(k)],bitMask(k));}
}
`

const entryWgsl = (subgroups: boolean, receiver: boolean) => /* wgsl */ `
/** Set where the pass projects one light (\`encodeVirtualShadowProjection\`): its light loops then
 *  end after that light as the compiler knows, which keeps nothing of the pixel past its trace for a
 *  next one, and its one light is the tile's one candidate. The same light either way. */
override VSM_PROJECTION_ONE_LIGHT:bool=false;
/** The tile's lights (lights 0-31, 32-63): those a pixel of it is in. */
var<workgroup> vsmTileLights:array<atomic<u32>,2>;
/** The tile's two light words and, with subgroups, its split word (\`voteWgsl\`), read uniformly. */
var<workgroup> vsmTileRead:vec3u;
/** The group's pixel \`groupIndex\` (Z-order) and what its lights read of it (\`VsmPixel\`). */
fn vsmPixelOf(groupId:vec2u,groupIndex:u32)->VsmPixel{
 let rect=vsmView.projectionRect;
 var p:VsmPixel;
 p.pos=${VSM_PROJECTION_GROUP_SIZE}u*groupId+vsmZOrderDecode(groupIndex)+vec2u(rect.xy);
 p.inRect=all(p.pos<vec2u(rect.zw));
 let coord=min(p.pos,vec2u(rect.zw)-1u);
 // The surface's texels are read at once; what they feed waits for \`info.valid\`.
 let deviceZ=textureLoad(vsmSceneDepth,coord,0);${
   receiver
     ? `
 // The receiver's texel too: its decode alone waits. In the rect \`coord\` is the pixel
 // \`shadowReceiver(svPosition.xy)\` reads.
 let receiverTexel=shadowReceiverTexel(vec2i(coord));`
     : ''
 }
 p.info=vsmSurfaceOf(coord,p.inRect,textureLoad(vsmNormalRough,coord,0).xyz);
 if(!p.info.valid){return p;}
 p.sceneDepth=vsmViewDepthOfDeviceZ(deviceZ,vsmView.depthFromDeviceZ);
 let svPosition=vec4f(vec2f(p.pos)+0.5,deviceZ,1.0);
 p.shifted=vsmPixelToShifted(svPosition);
 p.screenRayWorld=(vsmView.screenRayScale.xy*(vsm.screenRayShare*p.sceneDepth)+vsmView.screenRayScale.zw).y;
 p.noise=vsmNoiseOne(vec2u(svPosition.xy),vsmView.frameIndex);${
   receiver
     ? `
 // The engine's shadow receiver, as every shadow map of the engine reads it: the pixel's point
 // on the Phong surface its vertex normals describe rather than its flat triangle
 // (\`shadowReceiver\`), and the biases on the triangle's plane — the depth the caster drew —
 // turned to the side the shading normal faces (\`shadowBiasNormal\`). A smooth
 // normal over a coarse triangle otherwise under-biases one side of every edge, and a faceted
 // curved surface shadows itself, in facet-wide streaks, above its shading terminator. Only
 // where a light can shade the pixel: the background and a pixel no surface model lights pay no
 // triangle decode.
 let receiver=shadowReceiverOf(receiverTexel);
 p.shifted+=receiver.offset;
 if(dot(receiver.plane,receiver.plane)>0.0){p.info.biasNormal=select(receiver.plane,-receiver.plane,dot(receiver.plane,p.info.worldNormal)<0.0);}`
     : ''
 }
 return p;
}
/** The lights among \`candidates\` whose region holds the pixel (\`vsmLightParticipates\`), 32 a word. */
fn vsmPixelLights(pixel:VsmPixel,candidates:vec2u)->vec2u{
 var lights=vec2u(0u);
 if(!pixel.info.valid){return lights;}
 for(var w=0u;w<2u;w++){
  var rest=candidates[w];
  while(rest!=0u){
   let b=firstTrailingBit(rest);
   rest&=rest-1u;
   if(vsmLightParticipates(32u*w+b,pixel.info,pixel.shifted)){lights[w]|=1u<<b;}
  }
 }
 return lights;
}
/** The lanes of layer \`layer\` a tile holding \`tileLights\` holds a light of, bit n for lane n. */
fn vsmLayerLights(tileLights:vec2u,layer:u32)->u32{return (tileLights[layer>>3u]>>((4u*layer)&31u))&15u;}
/** The layers a tile holding \`tileLights\` stores (\`vsmProjectTile\`): bit L where it holds a
 *  light of layer L. */
fn vsmTileLayers(tileLights:vec2u)->u32{
 var layers=0u;
 for(var layer=0u;layer<${VSM_PROJECTION_MAX_PASS_LIGHTS / VSM_PROJECTION_MAX_LIGHTS}u;layer++){
  if(vsmLayerLights(tileLights,layer)!=0u){layers|=1u<<layer;}
 }
 return layers;
}
/** The tile's lights traced light by light in uniform flow (\`tileLights\` read uniformly, the bounds
 *  the view's), in increasing order: a layer holding one is traced and stored whole — a lane of a
 *  light the tile does not hold 0 —, a layer holding none is not stored. */
fn vsmProjectTile(pixel:VsmPixel,lights:vec2u,tileLights:vec2u,lightCount:u32,voteSplit:bool){
 for(var layer=0u;layer<ceilDiv(lightCount,4u);layer++){
  let held=vsmLayerLights(tileLights,layer);
  if(held==0u){continue;}
  let first=4u*layer;
  var word=0u;
  for(var lane=0u;lane<min(4u,lightCount-first);lane++){
   if((held&(1u<<lane))==0u){continue;}
   let k=first+lane;
   let r=vsmProjectLight(k,pixel,bitIsSet(lights[bitWord(k)],k),voteSplit);
   word|=vsmMaskCode(r)<<(8u*lane);
  }
  if(pixel.inRect){textureStore(vsmShadowMask,pixel.pos,layer,vec4u(word,0u,0u,0u));}
 }
}
/** The projection kernel: the shadow factor of each pixel for the pass's lights. */
@compute @workgroup_size(${VSM_PROJECTION_GROUP_SIZE * VSM_PROJECTION_GROUP_SIZE})
fn vsmProjection(@builtin(workgroup_id) groupId:vec3u,@builtin(local_invocation_index) groupIndex:u32${subgroups ? ',@builtin(subgroup_invocation_id) subgroupLane:u32' : ''}){
 vsmLaneInit(groupIndex);
 // @cut launch
 let pixel=vsmPixelOf(groupId.xy,groupIndex);
 // @cut decode keep: if(pixel.sceneDepth< -1.0e30){textureStore(vsmShadowMaskTiles,groupId.xy,vec4u(bitcast<u32>(pixel.shifted.x),0u,0u,0u));}
 let lightCount=select(vsmView.lightCount,1u,VSM_PROJECTION_ONE_LIGHT);
 // The lights that may reach the tile: the pass's one light; every light of a pass of suns alone,
 // which reach every lit point (a tile of none takes no light at its pixels either); else those
 // lane k finds of light k from the box the tile's lit points span (\`vsmLightMayReachTile\`).
 var candidates=vec2u(1u,0u);
 if(VSM_PROJECTION_KINDS==${VSM_PROJECTION_KINDS_DIRECTIONAL}u){candidates=vsmLightsBelow(lightCount);}
 else if(!VSM_PROJECTION_ONE_LIGHT){
  vsmTileBound(pixel.info.valid,pixel.shifted,${subgroups ? 'subgroupLane' : '0u'});
  workgroupBarrier();
  vsmTileCandidate(groupIndex,lightCount);
  workgroupBarrier();
  candidates=vec2u(atomicLoad(&vsmTileCandidates[0]),atomicLoad(&vsmTileCandidates[1]));
 }
 // @cut tileBounds keep: if(pixel.sceneDepth< -1.0e30){textureStore(vsmShadowMaskTiles,groupId.xy,vec4u(candidates.x^candidates.y,0u,0u,0u));}
 // The lights each pixel of the tile is in: a light no pixel of the tile is in is skipped by the
 // whole group, which writes what a pixel out of the light writes — background, off-screen and
 // out-of-range tiles trace nothing.
 let lights=vsmPixelLights(pixel,candidates);
 if(lights.x!=0u){atomicOr(&vsmTileLights[0],lights.x);}
 if(lights.y!=0u){atomicOr(&vsmTileLights[1],lights.y);}
 // @cut participation keep: if(pixel.sceneDepth< -1.0e30){textureStore(vsmShadowMaskTiles,groupId.xy,vec4u(lights.x^lights.y,0u,0u,0u));}
 workgroupBarrier();
 if(groupIndex==0u){
  let tile=vec2u(atomicLoad(&vsmTileLights[0]),atomicLoad(&vsmTileLights[1]));
  vsmTileRead=vec3u(tile,${subgroups ? 'atomicLoad(&vsmVoteSplit)' : '0u'});
  textureStore(vsmShadowMaskTiles,groupId.xy,vec4u(vsmTileLayers(tile),0u,0u,0u));
 }
 let tileRead=workgroupUniformLoad(&vsmTileRead);
 // @cut tileSetup keep: if(pixel.sceneDepth< -1.0e30){textureStore(vsmShadowMaskTiles,groupId.xy,vec4u(tileRead.x^tileRead.y,0u,0u,0u));}
 // Whether the votes take the counter (\`voteWgsl\`): uniform, as their barriers need.
 vsmProjectTile(pixel,lights,tileRead.xy,lightCount,${subgroups ? 'tileRead.z!=0u' : 'true'});
}
`

/** The opaque resolve's binding of the mask's tile words (`vsmMaskFactor`), past the receiver's. */
export const VSM_MASK_TILES_BINDING = 29

/** The whole module, for one layout (pool parts) and one vote variant. */
export function vsmProjectionWgsl(
  layout: VsmLayout,
  options: { subgroups: boolean; receiver?: boolean },
) {
  const { subgroups } = options,
    receiver = options.receiver ?? false
  // `enable` comes before every declaration, the library's included (`wgslProgram`).
  return wgslProgram(
    [
      subgroups ? 'enable subgroups;' : '',
      PROJECTION_VIEW,
      bindingsWgsl(),
      voteWgsl(subgroups),
      PIXEL_WGSL,
      traceWgsl(),
      tileBoundWgsl(subgroups),
      entryWgsl(subgroups, receiver),
    ].join('\n'),
    [
      VSM_CONSTANTS_WGSL,
      VSM_PROJECTION_DATA_WGSL,
      vsmBindingsWgsl(0, VSM_PROJECTION_VSM_SPECS, layout),
      VSM_TRACE_LIGHT_WGSL,
      vsmBlueNoiseWgsl(1, VSM_PROJECTION_BINDING.blueNoise),
      SCREEN_MARCH_WGSL(1, VSM_PROJECTION_BINDING.hizDepth),
      clipToFramebuffer,
      VSM_TRACE_COMMON_WGSL,
      VSM_TRACE_RESULT_WGSL,
      localLightReaches,
      // The traces sample this pass's pool and take the blue noise's pair.
      vsmTraceWgsl(
        vsmPoolLoadOf(0, VSM_PROJECTION_VSM_SPECS, layout),
        vsmBlueNoiseTwo(1, VSM_PROJECTION_BINDING.blueNoise),
      ),
      uvToNdc,
      unprojectPoint,
      ceilDivWgsl,
      bitWord,
      bitMask,
      bitIsSet,
      isFiniteWord,
      lowBits,
      FLOAT32_MIN_NORMAL,
      ...(receiver ? [receiverTargetReadWgsl(VSM_PROJECTION_RECEIVER_GROUP, 0)] : []),
    ],
  )
}
