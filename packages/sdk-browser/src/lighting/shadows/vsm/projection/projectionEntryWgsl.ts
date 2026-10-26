/**
 * The projection's kernels (`projectionWgsl.ts`), two, as the reference has two: the suns', a pass for
 * the suns in which every lane traces every sun in uniform flow, the adaptive ray count voted by the
 * group; and the local lights', one pass in which every pixel traces the lights of its own cell of the
 * light grid and packs their shares in its mask, the votes over the lanes that are active. Each is a
 * function: it reads the projection's shapes, which its module declares.
 */
import { VSM_PROJECTION_GROUP_SIZE } from '../constants.ts'
import { wgslBlock } from '../../../../../../math/src/wgsl/decl.ts'

/** The pixel `groupIndex` (Z-order) of the group over `tile` and what its lights read of it
 *  (`VsmPixel`): both kernels' first step. */
export const VSM_PROJECTION_PIXEL_OF_WGSL = wgslBlock(
  'VSM_PROJECTION_PIXEL_OF_WGSL',
  [],
  /* wgsl */ `
fn vsmPixelOf(tile:vec2u,groupIndex:u32)->VsmPixel{
 let rect=vsmView.projectionRect;
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
 p.sceneDepth=vsmViewDepthOfDeviceZ(deviceZ,vsmView.depthFromDeviceZ);
 let svPosition=vec4f(vec2f(p.pos)+0.5,deviceZ,1.0);
 p.shifted=vsmPixelToShifted(svPosition);
 p.screenRayWorld=(vsmView.screenRayScale.xy*(vsm.screenRayLength*p.sceneDepth)+vsmView.screenRayScale.zw).y;
 p.noise=blueNoiseScalar(vec2u(svPosition.xy),vsmView.frameIndex);
 return p;
}`,
)

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

/** The suns' kernel: every sun of the frame (the first `sunCount` records), a layer of the suns' mask a
 *  sun, each pixel of the rect written (a pixel no sun shades, 1). A thread never leaves alone: the
 *  loops that vote are bounded by uniform values, a thread out of the rect or out of a sun's region
 *  keeps iterating as a no-op. */
export const vsmSunsEntryWgsl = () => /* wgsl */ `${FIRST_PERSON_TRACE}
@compute @workgroup_size(${VSM_PROJECTION_GROUP_SIZE * VSM_PROJECTION_GROUP_SIZE})
fn vsmProjectSuns(@builtin(workgroup_id) groupId:vec3u,@builtin(local_invocation_index) groupIndex:u32){
 vsmLaneInit(groupIndex);
 let pixel=vsmPixelOf(groupId.xy,groupIndex);
 let receiver=vsmReceiverOf(pixel,pixel.info.valid);
 for(var k=0u;k<vsmView.sunCount;k++){
  let inLight=vsmLightParticipates(k,pixel.info,pixel.shifted);
  let own=vsmTraceLight(vsmView.lights[k],pixel,receiver,inLight);
  let r=vsmSubsurfaceShadow(vsmFirstPersonTrace(own,k,pixel,receiver,inLight),pixel.info);
  if(pixel.inRect){textureStore(vsmSunMask,pixel.pos,k,vec4f(select(1.0,r.shadowFactor,r.rayCount>0u)));}
 }
}
`

/** The local lights' kernel: each pixel traces the shadowed lights of its cell of the light grid (the
 *  one the lighting walks, `pixelCell`), in the order of the pruned grid (`lightGridWgsl.ts`) — the
 *  single-page lights last —, up to `vsm.onePassMaxLights` of them, and packs each share, dithered
 *  (`vsmFilterShadow`), in sixteenths, in four bits of its mask; the others are the lighting's to read from their own map. A light that
 *  does not shade the pixel packs a lit share. */
export const vsmLocalsEntryWgsl = () => /* wgsl */ `
/** \`share\` in lane \`lane\` of \`mask\`: its sixteenths in four bits (\`ONE_PASS_MASK_BITS\`). */
fn vsmMaskPack(mask:ptr<function,vec4u>,lane:u32,share:f32){
 (*mask)[lane/ONE_PASS_MASK_LANES]|=(u32(round(share*f32(ONE_PASS_MASK_MAX)))&ONE_PASS_MASK_MAX)<<((lane%ONE_PASS_MASK_LANES)*ONE_PASS_MASK_BITS);
}
@compute @workgroup_size(${VSM_PROJECTION_GROUP_SIZE * VSM_PROJECTION_GROUP_SIZE})
fn vsmProjectLocals(@builtin(workgroup_id) groupId:vec3u,@builtin(local_invocation_index) groupIndex:u32){
 let pixel=vsmPixelOf(groupId.xy,groupIndex);
 if(!pixel.inRect){return;}
 var mask=vec4u(0u);
 if(pixel.info.valid){
  let receiver=vsmReceiverOf(pixel,true);
  let base=pixelCell(vec2f(pixel.pos)-vec2f(vsmView.projectionRect.xy)+0.5,pixel.deviceZ);
  let list=vsmShadowedList(base);
  // One lane more than the mask holds: a light found there is the overflow, recorded and not traced.
  for(var lane=0u;lane<min(list.y,vsm.onePassMaxLights+1u);lane++){
   if(lane==vsm.onePassMaxLights){
    vsmStatsOr(VSM_OVERFLOW_FLAGS,VSM_OVERFLOW_ONE_PASS_MAX_LIGHTS);
    break;
   }
   let slice=i32(directLights.items[vsmShadowedRank(list,lane)].params.y);
   let k=shadowSliceRecord(slice);
   let inLight=vsmLightParticipates(k,pixel.info,pixel.shifted);
   let r=vsmSubsurfaceShadow(vsmTraceLight(vsmView.lights[k],pixel,receiver,inLight),pixel.info);
   vsmMaskPack(&mask,lane,select(1.0,vsmFilterShadow(r.shadowFactor,pixel.noise),r.rayCount>0u));
  }
 }
 textureStore(vsmLocalMask,pixel.pos,mask);
}
`
