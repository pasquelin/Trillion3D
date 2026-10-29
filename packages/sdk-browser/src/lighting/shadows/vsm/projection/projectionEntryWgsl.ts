/**
 * The projection's kernels (`projectionWgsl.ts`), two, as the reference has two: the suns', a pass for
 * the suns in which every lane traces every sun in uniform flow, the adaptive ray count voted by the
 * group; and the local lights', one pass in which every pixel traces the lights of its own cell of the
 * light grid and packs their shares in its mask, the votes over the lanes that are active. Each is a
 * function of the input type (`../inputType.ts`), as the reference's one shader is: the pixel of a group
 * of the view's tiles (the surfaces'), of a tile of the list of all the tiles with strands (the
 * strands', `VSM_STRANDS_PIXEL_OF_WGSL`) or of a tile of the list of the tiles that hold water (the
 * water's, `VSM_WATER_PIXEL_OF_WGSL`); it reads the projection's shapes, which its module declares.
 */
import { VSM_PROJECTION_GROUP_SIZE } from '../constants.ts'
import { wgslBlock } from '../../../../../../math/src/wgsl/decl.ts'
import { zOrderDecode } from '../../../../../../math/src/wgsl/integer.ts'
import { hairTilePixel } from '../../../../hair/tilesWgsl.ts'
import { HAIR_TILE_ALL } from '../../../../hair/visibilityMath.ts'
import type { VsmInputType } from '../inputType.ts'

/** The tail of every kernel's pixel, valid at the depth `deviceZ`: its view depth, its point, its screen
 *  ray's length and its noise. */
const PIXEL_TAIL = /* wgsl */ ` p.sceneDepth=vsmViewDepthOfDeviceZ(deviceZ,vsmView.depthFromDeviceZ);
 let svPosition=vec4f(vec2f(p.pos)+0.5,deviceZ,1.0);
 p.shifted=vsmPixelToShifted(svPosition);
 p.screenRayWorld=(vsmView.screenRayScale.xy*(vsm.screenRayLength*p.sceneDepth)+vsmView.screenRayScale.zw).y;
 p.noise=blueNoiseScalar(vec2u(svPosition.xy),vsmView.frameIndex);
 return p;
}`

/** The pixel `groupIndex` (Z-order) of the group over `tile` and what its lights read of it
 *  (`VsmPixel`) inside `rect`, an expression of the module (its x, y the first pixel, its z, w one past
 *  the last): every kernel's first step, named `name`. */
export const vsmPixelOfWgsl = (name: string, rect: string) =>
  wgslBlock(
    name,
    [],
    /* wgsl */ `
fn vsmPixelOf(tile:vec2u,groupIndex:u32)->VsmPixel{
 let rect=${rect};
 var p:VsmPixel;
 p.pos=${VSM_PROJECTION_GROUP_SIZE}u*tile+zOrderDecode(groupIndex)+vec2u(rect.xy);
 p.inRect=all(p.pos<vec2u(rect.zw));
 let coord=min(p.pos,vec2u(rect.zw)-1u);
 // The surface's texels are read at once; what they feed waits for \`info.valid\`. The depth is the
 // attachment's \`vsmSceneDepth\`, not level 0 of \`hizDepth\` (a colour target the visibility pass writes
 // beside it, which the screen ray alone marches): two resources, not proved to hold the same bits.
 let deviceZ=textureLoad(vsmSceneDepth,coord,0);
 p.deviceZ=deviceZ;
 p.info=vsmSurfaceOf(coord,p.inRect,textureLoad(vsmNormalRough,coord,0).xyz);
 if(!p.info.valid){return p;}
${PIXEL_TAIL}`,
  )

/** The pixel of a group of the whole view's rect: the suns' and the one-pass local lights' kernels'. */
export const VSM_PROJECTION_PIXEL_OF_WGSL = vsmPixelOfWgsl(
  'VSM_PROJECTION_PIXEL_OF_WGSL',
  'vsmView.projectionRect',
)

/** The pixel `groupIndex` (Z-order) of the tile of rank `rank` of the list of all the tiles with strands,
 *  inside the view's rect: the kernels' first step for the input `strands`. The pixel is a strand's at
 *  the depth of the nearest strand, valid where one is (the reference's hair input, whose pixel with no
 *  strand shades nothing); it reads no surface: no thin transmission (`opacity` −1, the reference's gate
 *  of its hair input), no subsurface, no coat, not a first-person one, its receiver plane facing the
 *  light (`hair`, which the slope of the trace reads, as the reference turns a hair's normal to the
 *  light). Its tail is the surfaces' pixel's (`PIXEL_TAIL`). */
export const VSM_STRANDS_PIXEL_OF_WGSL = wgslBlock(
  'VSM_STRANDS_PIXEL_OF_WGSL',
  [zOrderDecode, hairTilePixel],
  /* wgsl */ `
fn vsmPixelOf(rank:u32,groupIndex:u32)->VsmPixel{
 let rect=vsmView.projectionRect;
 var p:VsmPixel;
 let listed=rank<vsmHairCounts[${HAIR_TILE_ALL}];
 p.pos=hairTilePixel(vsmHairTiles[select(0u,rank,listed)],zOrderDecode(groupIndex))+vec2u(rect.xy);
 p.inRect=listed&&all(p.pos<vec2u(rect.zw));
 let coord=min(p.pos,vec2u(rect.zw)-1u);
 let deviceZ=textureLoad(vsmHairDepth,coord,0).x;
 p.deviceZ=deviceZ;
 p.info.valid=p.inRect&&deviceZ>0.0;
 p.info.hair=true;
 p.info.opacity=-1.0;
 if(!p.info.valid){return p;}
${PIXEL_TAIL}
/** A strand's receiver for the light \`light\`: the pixel's point moved toward the light by the normal
 *  bias, the light's direction standing for the normal a strand has none of (the reference's light vector
 *  for its hair input), light by light; no screen segment. */
fn vsmStrandReceiverOf(pixel:VsmPixel,light:VsmProjectionLight,participating:bool)->VsmReceiver{
 var r:VsmReceiver;
 r.P=pixel.shifted;
 if(participating){
  let toLight=light.shiftedPosition-pixel.shifted;
  let axis=select(normalize(toLight),light.direction,light.kind==LIGHT_KIND_DIRECTIONAL);
  r.P+=axis*vsmNormalOffset(r.P-vsmView.shiftedEye);
 }
 return r;
}`,
)

/** The pixel `groupIndex` (Z-order) of the tile of rank `rank` of the list of the tiles that hold water, inside
 *  the view's rect: the kernels' first step for the input `water`. The pixel is the water's surface where its
 *  normal was written (the shading writes none elsewhere), at the water's depth; it reads no thin transmission
 *  nor coat, and is no first-person one. Its tail is the surfaces' pixel's (`PIXEL_TAIL`). */
export const VSM_WATER_PIXEL_OF_WGSL = wgslBlock(
  'VSM_WATER_PIXEL_OF_WGSL',
  [zOrderDecode],
  /* wgsl */ `
fn vsmPixelOf(rank:u32,groupIndex:u32)->VsmPixel{
 let rect=vsmView.projectionRect;
 var p:VsmPixel;
 let listed=rank<vsmWaterCount.x;
 let packed=vsmWaterTiles[select(0u,rank,listed)];
 p.pos=vec2u(packed&0xffffu,packed>>16u)*${VSM_PROJECTION_GROUP_SIZE}u+zOrderDecode(groupIndex)+vec2u(rect.xy);
 p.inRect=listed&&all(p.pos<vec2u(rect.zw));
 let coord=min(p.pos,vec2u(rect.zw)-1u);
 let deviceZ=textureLoad(vsmSceneDepth,coord,0);
 p.deviceZ=deviceZ;
 let normal=textureLoad(vsmNormalRough,coord,0).xyz;
 p.info.valid=p.inRect&&deviceZ>0.0&&dot(normal,normal)>0.25;
 p.info.opacity=-1.0;
 if(!p.info.valid){return p;}
 p.info.worldNormal=normalize(normal);
${PIXEL_TAIL}`,
)

/** What the kernels' text takes of their input (`../inputType.ts`): the builtin a strands' kernel reads
 *  its rank by, its pixel, and its receiver, once a pixel for a surface (its normal), light by light for a
 *  strand (the light's direction). */
const KERNEL_INPUT = {
  gbuffer: {
    groups: '',
    pixel: 'vsmPixelOf(groupId.xy,groupIndex)',
    once: '\n let receiver=vsmReceiverOf(pixel,pixel.info.valid);',
    each: '',
  },
  water: {
    groups: '@builtin(num_workgroups) groups:vec3u,',
    pixel: 'vsmPixelOf(flatIndex(groupId,groups,1u),groupIndex)',
    once: '\n let receiver=vsmReceiverOf(pixel,pixel.info.valid);',
    each: '',
  },
  strands: {
    groups: '@builtin(num_workgroups) groups:vec3u,',
    pixel: 'vsmPixelOf(flatIndex(groupId,groups,1u),groupIndex)',
    once: '',
    each: '\n  let receiver=vsmStrandReceiverOf(pixel,vsmView.lights[k],inLight);',
  },
} as const satisfies Record<VsmInputType, Record<'groups' | 'pixel' | 'once' | 'each', string>>

/** A sun's trace with the shadow its first-person clipmap casts (`VsmProjectionLight.firstPersonMapId`)
 *  merged in: the clipmap holds the objects that stand for a first-person one alone, so it shades the
 *  receivers that are not first-person ones and are not fully shadowed already, the most shadowed of the
 *  two taken with its occluder distance. The trace is made by every lane of the group (`participating`
 *  says which take part), as a light's own. */
const FIRST_PERSON_TRACE = /* wgsl */ `
fn vsmFirstPersonTrace(r:VsmTraceResult,k:u32,pixel:VsmPixel,receiver:VsmReceiver,participating:bool)->VsmTraceResult{
 let light=vsmView.lights[k];
 if(light.firstPersonMapId<0){return r;}
 var own=light;
 own.mapId=light.firstPersonMapId;
 let shadowedWhole=r.rayCount>0u&&r.shadowFactor==0.0;
 let fp=vsmTraceLight(own,pixel,receiver,participating&&!pixel.info.firstPerson&&!shadowedWhole);
 if(fp.rayCount==0u){return r;}
 if(r.rayCount==0u){return fp;}
 // The most shadowed of the two, and the occluder distance that goes with it.
 if(fp.shadowFactor<=r.shadowFactor){return fp;}
 return r;
}
`

/** A sun's trace under its prefiltered distant shadow (`projectionPrefilteredWgsl.ts`), where its
 *  clipmap holds one: the sample first, at the receiver's biased point; a receiver it shadows whole
 *  is not traced (the lane is not `participating`), any other is traced and the two shares multiply. */
const PREFILTERED_TRACE = /* wgsl */ `  let prefiltered=vsmPrefilteredSample(vsmView.lights[k],receiver.P,inLight);
  let own=vsmPrefilteredCombine(prefiltered,vsmTraceLight(vsmView.lights[k],pixel,receiver,inLight&&!vsmPrefilteredWhole(prefiltered)));`

/** The suns' store under the shadow the strands cast on the surfaces (the `hair` cut): the least of the light's share and the layer of the light (`vsmHairShadow`, a layer a light of the frame). */
const HAIR_SUN_STORE = `  var held=select(1.0,r.shadowFactor,r.rayCount>0u);
  if(i32(k)<i32(textureNumLayers(vsmHairShadow))){held=min(held,textureLoad(vsmHairShadow,pixel.pos,i32(k),0).x);}
  if(pixel.inRect){textureStore(vsmSunMask,pixel.pos,k,vec4f(held));}`

/** The local lights' share under the strands' shadow (the `hair` cut), as the capsules' is. */
const HAIR_LOCAL_SHARE = `
   if(i32(k)<i32(textureNumLayers(vsmHairShadow))){
    share=min(share,textureLoad(vsmHairShadow,pixel.pos,i32(k),0).x);
   }`

/** The suns' kernel: every sun of the frame (the first `sunCount` records), a layer of the suns' mask a
 *  sun, each pixel of the rect written (a pixel no sun shades, 1). A thread never leaves alone: the
 *  loops that vote are bounded by uniform values, a thread out of the rect or out of a sun's region
 *  keeps iterating as a no-op. With `prefiltered`, each sun is first sampled in its prefiltered distant
 *  shadow (`PREFILTERED_TRACE`). */
export const vsmSunsEntryWgsl = (
  prefiltered = false,
  input: VsmInputType = 'gbuffer',
  hair = false,
) => {
  const t = KERNEL_INPUT[input]
  return /* wgsl */ `${FIRST_PERSON_TRACE}
@compute @workgroup_size(${VSM_PROJECTION_GROUP_SIZE * VSM_PROJECTION_GROUP_SIZE})
fn vsmProjectSuns(@builtin(workgroup_id) groupId:vec3u,${t.groups}@builtin(local_invocation_index) groupIndex:u32){
 vsmLaneInit(groupIndex);
 let pixel=${t.pixel};${t.once}
 for(var k=0u;k<vsmView.sunCount;k++){
  let inLight=vsmLightParticipates(k,pixel.info,pixel.shifted);${t.each}
${prefiltered ? PREFILTERED_TRACE : '  let own=vsmTraceLight(vsmView.lights[k],pixel,receiver,inLight);'}
  let r=vsmSubsurfaceShadow(vsmFirstPersonTrace(own,k,pixel,receiver,inLight),pixel.info);
${hair ? HAIR_SUN_STORE : '  if(pixel.inRect){textureStore(vsmSunMask,pixel.pos,k,vec4f(select(1.0,r.shadowFactor,r.rayCount>0u)));}'}
 }
}
`
}

/** The local lights' kernel: each pixel traces the shadowed lights of its cell of the light grid (the
 *  one the lighting walks, `pixelCell`), in the order of the pruned grid (`lightGridWgsl.ts`) — the
 *  single-page lights last —, up to `vsm.onePassMaxLights` of them, and packs each share, dithered
 *  (`vsmFilterShadow`), in sixteenths, in four bits of its mask; the others are the lighting's to read from their own map. A light that
 *  does not shade the pixel packs a lit share. The group is in uniform flow, as the suns' pass is, so
 *  that the adaptive ray count votes over its 32-pixel halves (`vsmProjectionVoteWgsl`): the loop runs
 *  to the longest list of the group's pixels (`vsmListBound`), a pixel past its own list (or out of
 *  the rect) traces as a no-op and votes neutrally. */
export const vsmLocalsEntryWgsl = (
  subgroups: boolean,
  input: VsmInputType = 'gbuffer',
  capsule = false,
  hair = false,
) => {
  const t = KERNEL_INPUT[input]
  return /* wgsl */ `
/** \`share\` in lane \`lane\` of \`mask\`: its sixteenths in four bits (\`ONE_PASS_MASK_BITS\`). */
fn vsmMaskPack(mask:ptr<function,vec4u>,lane:u32,share:f32){
 (*mask)[lane/ONE_PASS_MASK_LANES]|=(u32(round(share*f32(ONE_PASS_MASK_MAX)))&ONE_PASS_MASK_MAX)<<((lane%ONE_PASS_MASK_LANES)*ONE_PASS_MASK_BITS);
}
/** The longest list of the group's pixels, and the bound of the loop that walks them. */
var<workgroup> vsmListMost:atomic<u32>;
var<workgroup> vsmListBound:u32;
@compute @workgroup_size(${VSM_PROJECTION_GROUP_SIZE * VSM_PROJECTION_GROUP_SIZE})
fn vsmProjectLocals(@builtin(workgroup_id) groupId:vec3u,${t.groups}@builtin(local_invocation_index) groupIndex:u32){
 vsmLaneInit(groupIndex);
 let pixel=${t.pixel};
 var mask=vec4u(0u);
 var list=vec2u(0u);
 if(pixel.info.valid){
  list=vsmShadowedList(pixelCell(vec2f(pixel.pos)-vec2f(vsmView.projectionRect.xy)+0.5,pixel.deviceZ));
  // A light past the mask is the overflow, recorded and not traced.
  if(list.y>vsm.onePassMaxLights){vsmStatsOr(VSM_OVERFLOW_FLAGS,VSM_OVERFLOW_ONE_PASS_MAX_LIGHTS);}
 }
 let own=min(list.y,vsm.onePassMaxLights);
${
  subgroups
    ? ' let longest=subgroupMax(own);\n if(subgroupElect()){atomicMax(&vsmListMost,longest);}'
    : ' atomicMax(&vsmListMost,own);'
}
 workgroupBarrier();
 if(groupIndex==0u){vsmListBound=atomicLoad(&vsmListMost);}
 let bound=workgroupUniformLoad(&vsmListBound);
 if(bound==0u){
  if(pixel.inRect){textureStore(vsmLocalMask,pixel.pos,mask);}
  return;
 }${t.once}
 for(var lane=0u;lane<bound;lane++){
  let listed=lane<own;
  var k=0u;
  if(listed){k=shadowSliceRecord(i32(directLights.items[vsmShadowedRank(list,lane)].params.y));}
  let inLight=listed&&vsmLightParticipates(k,pixel.info,pixel.shifted);${t.each}
  let r=vsmSubsurfaceShadow(vsmTraceLight(vsmView.lights[k],pixel,receiver,inLight),pixel.info);
  if(listed){
   var share=select(1.0,vsmFilterShadow(r.shadowFactor,pixel.noise),r.rayCount>0u);${
     capsule
       ? '\n   if(i32(k)<i32(textureNumLayers(vsmCapsule))){\n    let held=textureLoad(vsmCapsule,pixel.pos,i32(k),0).x;\n    share=min(share,held*held);\n   }'
       : ''
   }${hair ? HAIR_LOCAL_SHARE : ''}
   vsmMaskPack(&mask,lane,share);
  }
 }
 if(pixel.inRect){textureStore(vsmLocalMask,pixel.pos,mask);}
}
`
}
