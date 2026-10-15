/**
 * The projection's kernel (`projectionWgsl.ts`): a group's pixels, their tile's lights, each light
 * traced in uniform flow and stored in its mask layer. A function: it reads the projection's
 * shapes, which its module declares.
 */
import { VSM_PROJECTION_MAX_PASS_LIGHTS } from './projectionView.ts'
import { VSM_PROJECTION_GROUP_SIZE, VSM_PROJECTION_MAX_LIGHTS } from './projectionWgsl.ts'

export const vsmProjectionEntryWgsl = () => /* wgsl */ `
/** The tile's lights (lights 0-31, 32-63): those a pixel of it is in. */
var<workgroup> vsmTileLights:array<atomic<u32>,2>;
/** The tile's two light words, read uniformly. */
var<workgroup> vsmTileRead:vec2u;
/** The group's pixel \`groupIndex\` (Z-order) and what its lights read of it (\`VsmPixel\`). */
fn vsmPixelOf(groupId:vec2u,groupIndex:u32)->VsmPixel{
 let rect=vsmView.projectionRect;
 var p:VsmPixel;
 p.pos=${VSM_PROJECTION_GROUP_SIZE}u*groupId+vsmZOrderDecode(groupIndex)+vec2u(rect.xy);
 p.inRect=all(p.pos<vec2u(rect.zw));
 let coord=min(p.pos,vec2u(rect.zw)-1u);
 // The surface's texels are read at once; what they feed waits for \`info.valid\`. The depth is the
 // attachment's \`vsmSceneDepth\`, not level 0 of \`hizDepth\` (a colour target the visibility pass writes
 // beside it, which the screen ray alone marches): two resources, not proved to hold the same bits.
 let deviceZ=textureLoad(vsmSceneDepth,coord,0);
 // The receiver's texel too: its decode alone waits. In the rect \`coord\` is the pixel
 // \`shadowReceiver(svPosition.xy)\` reads.
 let receiverTexel=shadowReceiverTexel(vec2i(coord));
 p.info=vsmSurfaceOf(coord,p.inRect,textureLoad(vsmNormalRough,coord,0).xyz);
 if(!p.info.valid){return p;}
 p.sceneDepth=vsmViewDepthOfDeviceZ(deviceZ,vsmView.depthFromDeviceZ);
 let svPosition=vec4f(vec2f(p.pos)+0.5,deviceZ,1.0);
 p.shifted=vsmPixelToShifted(svPosition);
 p.screenRayWorld=(vsmView.screenRayScale.xy*(vsm.screenRayShare*p.sceneDepth)+vsmView.screenRayScale.zw).y;
 p.noise=vsmNoiseOne(vec2u(svPosition.xy),vsmView.frameIndex);
 // The engine's shadow receiver, as every shadow map of the engine reads it: the pixel's point
 // on the Phong surface its vertex normals describe rather than its flat triangle
 // (\`shadowReceiver\`), and the biases on the triangle's plane — the depth the caster drew —
 // turned to the side the shading normal faces (\`vsmBiasNormal\`). A smooth
 // normal over a coarse triangle otherwise under-biases one side of every edge, and a faceted
 // curved surface shadows itself, in facet-wide streaks, above its shading terminator. Only
 // where a light can shade the pixel: the background and a pixel no surface model lights pay no
 // triangle decode.
 let receiver=shadowReceiverOf(receiverTexel);
 p.shifted+=receiver.offset;
 p.info.biasNormal=vsmBiasNormal(p.info.worldNormal,receiver.plane);
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
fn vsmProjectTile(pixel:VsmPixel,lights:vec2u,tileLights:vec2u,lightCount:u32){
 for(var layer=0u;layer<ceilDiv(lightCount,4u);layer++){
  let held=vsmLayerLights(tileLights,layer);
  if(held==0u){continue;}
  let first=4u*layer;
  var word=0u;
  for(var lane=0u;lane<min(4u,lightCount-first);lane++){
   if((held&(1u<<lane))==0u){continue;}
   let k=first+lane;
   let r=vsmProjectLight(k,pixel,bitIsSet(lights[bitWord(k)],k));
   word|=vsmMaskCode(r)<<(8u*lane);
  }
  if(pixel.inRect){textureStore(vsmShadowMask,pixel.pos,layer,vec4u(word,0u,0u,0u));}
 }
}
/** The projection kernel: the shadow factor of each pixel for the pass's lights. */
@compute @workgroup_size(${VSM_PROJECTION_GROUP_SIZE * VSM_PROJECTION_GROUP_SIZE})
fn vsmProjection(@builtin(workgroup_id) groupId:vec3u,@builtin(local_invocation_index) groupIndex:u32){
 vsmLaneInit(groupIndex);
 // @cut launch
 let pixel=vsmPixelOf(groupId.xy,groupIndex);
 // @cut decode keep: if(pixel.sceneDepth< -1.0e30){textureStore(vsmShadowMaskTiles,groupId.xy,vec4u(bitcast<u32>(pixel.shifted.x),0u,0u,0u));}
 let lightCount=vsmView.lightCount;
 // The lights that may reach the tile: those lane k finds of light k from the box the tile's lit
 // points span (\`vsmLightMayReachTile\`), a sun every tile with a lit point.
 vsmTileBound(pixel.info.valid,pixel.shifted);
 workgroupBarrier();
 vsmTileCandidate(groupIndex,lightCount);
 workgroupBarrier();
 let candidates=vec2u(atomicLoad(&vsmTileCandidates[0]),atomicLoad(&vsmTileCandidates[1]));
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
  vsmTileRead=tile;
  textureStore(vsmShadowMaskTiles,groupId.xy,vec4u(vsmTileLayers(tile),0u,0u,0u));
 }
 let tileRead=workgroupUniformLoad(&vsmTileRead);
 // @cut tileSetup keep: if(pixel.sceneDepth< -1.0e30){textureStore(vsmShadowMaskTiles,groupId.xy,vec4u(tileRead.x^tileRead.y,0u,0u,0u));}
 vsmProjectTile(pixel,lights,tileRead,lightCount);
}
`
