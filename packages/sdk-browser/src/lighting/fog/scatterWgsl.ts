import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { ndcToUv, perspectiveDivide } from '../../../../math/src/wgsl/projection.ts'
import { rand4dPcg32 } from '../../../../math/src/wgsl/sampling.ts'
import { FOG_VOLUME_FLAG } from './frame.ts'
import { FOG_GRID_WGSL } from './gridWgsl.ts'
import { FOG_LIGHTS_WGSL } from './lightsWgsl.ts'

/**
 * THE LIGHT EACH CELL OF THE VOLUME SCATTERS, one thread a cell: the sum of what the lights give
 * the cell's samples times what its medium scatters, plus the medium's own light, blended with the
 * volume of the image before.
 *
 * A cell takes one sample, at the offset the image's jitter names — the cell's centre without
 * jitter —, moved forward off the depth buffer (`fogLiftOffSurface`); where its history is missing
 * it takes `frame.blend.y` of them, one for each of the offsets of the images before, and
 * averages them, so that a cell the camera just uncovered is as smooth as one the blend has kept. A
 * cell wholly behind the surfaces of its pixels — the furthest depth over its pixels and half a cell
 * around them (`fogFurthest`) is nearer than the cell, half a cell toward the eye — is not lit:
 * it holds nothing, light or extinction.
 *
 * The history of a cell is the previous volume (\`fogPreviousVolume\`) at where the cell's centre was in the previous image: its
 * point through the previous view-projection, the slice of its depth. It is dropped where that
 * falls outside the volume, or where the surfaces of the previous image hid it (\`fogRepairHistory\`: the
 * four cells around the read are tested against the previous image's furthest depth; one
 * that failed moves the read toward the side that passed, none that passed drops the history).
 * The blend is \`frame.blend.x\` of the history; the result is kept where it is positive and finite as a
 * 32-bit float, and made zero where it is not (\`fogPositiveFinite\`).
 */
export const FOG_SCATTER_WGSL = wgslBlock(
  'FOG_SCATTER_WGSL',
  [FOG_GRID_WGSL, FOG_LIGHTS_WGSL, rand4dPcg32, ndcToUv, perspectiveDivide],
  `
/** Three random numbers of the cell and the sample, each in [−1, 1]. */
fn fogRand(cell:vec3u,sample:u32)->vec3f{
 let v=rand4dPcg32(vec4i(vec3i(cell),i32(frame.frame.x+8u*sample)));
 return vec3f(v.xyz)/4294967295.0*2.0-1.0;
}
/** Where the cell at \`P\` was in the previous volume, in its texture coordinates: its place in the
 *  previous view, over the cells that image covered of the textures, held to where they end. Its
 *  depth there is the clip weight, or for an orthographic view — whose weight is 1 — the depth the
 *  clip depth gives. */
fn fogHistoryUV(P:vec3f)->vec3f{
 let clip=frame.prevViewProj*vec4f(P,1.0);
 let depth=select(clip.w,(clip.z/clip.w-frame.depthMap.y)/frame.depthMap.x,fogOrtho());
 let uvw=vec3f(ndcToUv(perspectiveDivide(clip).xy),fogSliceAtDepth(depth)*frame.sliceMap.w);
 return min(uvw*vec3f(frame.history.xy,1.0),vec3f(frame.history.zw,1.0));
}
/** The four texels of the previous furthest depth around \`uv\`, in the order a gather returns
 *  them: bottom-left, bottom-right, top-right, top-left. */
fn fogPreviousAround(uv:vec2f)->vec4f{
 let last=vec2i(frame.texture.xy)-vec2i(1);
 let at=vec2i(floor(uv*frame.texture.xy-0.5));
 let w=textureLoad(fogPreviousFurthest,clamp(at,vec2i(0),last),0).r;
 let z=textureLoad(fogPreviousFurthest,clamp(at+vec2i(1,0),vec2i(0),last),0).r;
 let x=textureLoad(fogPreviousFurthest,clamp(at+vec2i(0,1),vec2i(0),last),0).r;
 let y=textureLoad(fogPreviousFurthest,clamp(at+vec2i(1,1),vec2i(0),last),0).r;
 return vec4f(x,y,z,w);
}
struct FogHistory{uv:vec2f,valid:bool,}
/** The read \`uv\` of the previous volume moved off the cells the previous image's surfaces hid: the
 *  cell's depth \`z\` before (device) against the furthest depth around the four cells it falls
 *  between. */
fn fogRepairHistory(uv:vec2f,z:f32)->FogHistory{
 let size=frame.texture.xy;
 let full=uv*size;
 let at=max(floor(full-0.5),vec2f(0.0));
 let inside=full-at;
 let seen=fogPreviousAround(min((at+1.0)/size/frame.previous.xy,frame.previous.zw))<vec4f(z);
 if(all(seen)){return FogHistory(uv,true);}
 if(all(seen.wz)){return FogHistory((at+vec2f(inside.x,0.5))/size,true);}
 if(all(seen.xy)){return FogHistory((at+vec2f(inside.x,1.5))/size,true);}
 if(all(seen.wx)){return FogHistory((at+vec2f(0.5,inside.y))/size,true);}
 if(all(seen.zy)){return FogHistory((at+vec2f(1.5,inside.y))/size,true);}
 if(seen.x){return FogHistory((at+vec2f(0.5,1.5))/size,true);}
 if(seen.y){return FogHistory((at+vec2f(1.5,1.5))/size,true);}
 if(seen.w){return FogHistory((at+vec2f(0.5,0.5))/size,true);}
 if(seen.z){return FogHistory((at+vec2f(1.5,0.5))/size,true);}
 return FogHistory(uv,false);
}
/** The light of a cell over \`samples\` samples, one for each offset of the jitter. */
fn fogCellLight(cell:vec3u,samples:u32)->vec3f{
 var sum=vec3f(0.0);
 for(var s=0u;s<samples;s++){
  var jitter=frame.offsets[s].xyz;
  if(frame.tune.z>0.0){jitter+=frame.tune.z*fogRand(cell,s);}
  let offset=fogLiftOffSurface(cell,jitter);
  sum+=fogLightAt(cell,offset);
 }
 return sum/f32(samples);
}
@compute @workgroup_size(4,4,4)
fn scatterMain(@builtin(global_invocation_id) cell:vec3u){
 if(any(cell>=vec3u(frame.grid.xyz))){return;}
 let flags=u32(frame.medium.w);
 let reproject=(flags&${FOG_VOLUME_FLAG.usesHistory}u)!=0u;
 let skipHidden=(flags&${FOG_VOLUME_FLAG.skipHidden}u)!=0u;
 var back=vec4f(0.0);
 if(skipHidden){
  back=vec4f(fogCellPoint(cell,vec3f(0.5,0.5,-0.5)).xyz,1.0);
  let clip=frame.depthViewProj*back;
  let furthest=textureLoad(fogFurthest,vec2i(min(cell.xy,vec2u(frame.grid.xy)-vec2u(1u))),0).r;
  if(furthest>clip.z/clip.w){textureStore(fogScattering,vec3i(cell),vec4f(0.0));return;}
 }
 var historyUV=fogHistoryUV(fogCellPoint(cell,vec3f(0.5)).xyz);
 var valid=true;
 if(skipHidden&&reproject){
  let before=frame.prevViewProj*back;
  let moved=fogRepairHistory(historyUV.xy,before.z/before.w);
  historyUV=vec3f(moved.uv,historyUV.z);
  valid=moved.valid;
 }
 var alpha=frame.blend.x;
 var samples=1u;
 if(reproject){
  if(any(historyUV<vec3f(0.0))||any(historyUV>=vec3f(frame.history.zw,1.0))||!valid){alpha=0.0;}
  if(alpha<0.001&&frame.blend.y>1.0){samples=u32(frame.blend.y);}
 }
 let medium=fogMedium(cell);
 var result=vec4f(fogCellLight(cell,samples)*medium.scattering.xyz+medium.glow,medium.scattering.w);
 if(alpha>0.0){
  let past=textureSampleLevel(fogPreviousVolume,fogSampler,min(historyUV,vec3f(frame.previous.zw,1.0)),0.0);
  result=mix(result,past,alpha);
 }
 textureStore(fogScattering,vec3i(cell),fogPositiveFinite(result));
}`,
)
