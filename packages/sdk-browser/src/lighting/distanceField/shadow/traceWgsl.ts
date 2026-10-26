import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { pixelToNdc } from '../../../../../math/src/wgsl/projection.ts'
import { hizDepthWgsl } from '../../../visibility/hiz/gpu/pyramidTexture.ts'
import { SUBSURFACE_FLAG } from '../../../materials/surface/subsurface.ts'
import { meshFieldWgsl } from '../meshFieldWgsl.ts'
import { DFSH_COMMON_WGSL } from './commonWgsl.ts'
import {
  DFSH_BINDING as B,
  DFSH_HALF_FORMAT,
  DFSH_MAX_CONE_RADIUS,
  DFSH_MIN_CONE_RADIUS,
  DFSH_TILE,
} from './layout.ts'

/**
 * THE RAY OF A PIXEL THROUGH A MESH'S FIELD (`dfshTraceObject`), the visibility it leaves `visibility`
 * at the least of: the ray, from the surface toward the sun, is taken into the mesh's volume and
 * clipped to its box grown by the cone's radius at the mesh (the tangent of the sun's angle over the
 * distance along the ray to the mesh's centre, at most the widest cone radius); each step reads the
 * field at the sample held to the box (the distance to the box added to the field's), the visibility
 * of the step the share of the cone's radius there (held between the narrowest and the widest) the
 * distance covers, at least the mesh's self-shadow ramp; the next step is that distance, or a
 * quarter of the steps' count's inverse at least; the ray stops when fully occluded or past the
 * box, and as it nears the last step it is forced toward shadow. A two-sided mesh has its surface
 * expanded, by its bias times the share of the ray that has gone, over twice the bias. For a thin
 * transmitting surface (`density` above 0) a step's visibility is at least what the light keeps
 * through the thickness it has gone in the mesh's volume (the time along the ray, scaled to the world),
 * the exponential of the minus thickness times the density, so that it is never wholly occluded.
 */
const DFSH_TRACE_OBJECT_WGSL = wgslBlock(
  'DFSH_TRACE_OBJECT_WGSL',
  [DFSH_COMMON_WGSL, meshFieldWgsl(0, B.objects)],
  `
fn dfshLineBox(origin:vec3f,end:vec3f,boxMin:vec3f,boxMax:vec3f)->vec2f{
 let inverse=1.0/(end-origin);
 let first=(boxMin-origin)*inverse;
 let second=(boxMax-origin)*inverse;
 let farthest=max(first,second);
 let closest=min(first,second);
 return saturate(vec2f(max(closest.x,max(closest.y,closest.z)),min(farthest.x,min(farthest.y,farthest.z))));
}
fn dfshTraceObject(object:u32,rayStart:vec3f,rayEnd:vec3f,tanAngle:f32,visibilityIn:f32,density:f32)->f32{
 var visibility=visibilityIn;
 let data=loadDfObjectData(object);
 let volumeStart=dfWorldToVolume(data,dfshWorld(rayStart));
 let volumeEnd=dfWorldToVolume(data,dfshWorld(rayEnd));
 var direction=volumeEnd-volumeStart;
 let rayLength=length(direction);
 direction=direction/rayLength;
 let toVolume=1.0/max(data.toWorldScale.x,max(data.toWorldScale.y,data.toWorldScale.z));
 let minRadius=${DFSH_MIN_CONE_RADIUS}*toVolume;
 var maxRadius=${DFSH_MAX_CONE_RADIUS}.0*toVolume;
 let selfShadowScale=1.0/max(data.selfShadowBias*toVolume,0.0001);
 let coneAtObject=min(tanAngle*max(dot(-volumeStart,direction),0.0),maxRadius);
 let times=dfshLineBox(volumeStart,volumeEnd,-data.extent-vec3f(coneAtObject),data.extent+vec3f(coneAtObject));
 if(times.x>=times.y){return visibility;}
 let mips=dfAssetMip(data.asset,0u).numMips;
 let asset=dfAssetMip(data.asset,mips-1u);
 let expand=data.surfaceBias*(exp2(f32(DF_MAX_MIPS)-f32(mips))+select(0.0,dfsh.range.z-1.0,data.mostlyTwoSided));
 var maxEncoded=asset.scaleBias.x+asset.scaleBias.y;
 if(data.mostlyTwoSided){maxEncoded-=expand;}
 maxRadius=min(maxRadius,maxEncoded);
 let maxSteps=u32(dfsh.trace.z);
 let minStep=1.0/(4.0*dfsh.trace.z);
 var time=times.x*rayLength;
 let endTime=times.y*rayLength;
 var stopped=maxSteps;
 for(var iteration=0u;iteration<maxSteps;iteration++){
  let at=volumeStart+direction*time;
  let clamped=clamp(at,-data.extent,data.extent);
  var field=sampleSparseMeshSdf(clamped,asset)+length(clamped-at);
  if(data.mostlyTwoSided){field-=expand*saturate(time/max(2.0*expand,1e-6));}
  let selfShadow=1.0-saturate(time*selfShadowScale);
  let radius=clamp(tanAngle*time,minRadius,maxRadius);
  var share=max(saturate(field/radius),selfShadow);
  if(density>0.0){share=max(share,saturate(exp(-time*data.volumeScale*density)));}
  visibility=min(visibility,share);
  time+=max(abs(field),minStep);
  if(visibility<0.01||time>endTime){
   stopped=iteration;
   break;
  }
 }
 return min(visibility,1.0-f32(stopped)/f32(maxSteps));
}`,
)

/**
 * THE CASCADE TRACED (`dfshTrace`), a thread a texel of the half-resolution result, in the rows of
 * the light's layer: the pixel at the texel's top left, with the depth at it, rays from its surface
 * toward the sun (`dfshTraceObject`), started off the surface by 2 centimetres and the share of the depth
 * (`trace.y`) and as long as the light's trace distance, through the meshes the pixel's tile lists,
 * in the order of the list, stopping at full occlusion; a pixel whose surface is a thin transmitting
 * sheet (the subsurface bit of its flags) traces with the density of the light it lets through
 * (`trace.w`). Only a pixel the cascade reaches is traced: some
 * pixel of the texel's block (the farthest, with a half-resolution result) farther than the cascade's
 * nearest depth and the texel's own nearer than its farthest. It writes the visibility and the depth
 * it was traced at (the upsample weighs by it), 1 where nothing was traced.
 */
export const DFSH_TRACE_WGSL = wgslProgram(
  `@group(0) @binding(${B.tileOffsets}) var<storage,read> tileOffsets:array<u32>;
@group(0) @binding(${B.tileCounts}) var<storage,read> tileCounts:array<u32>;
@group(0) @binding(${B.tileData}) var<storage,read> tileData:array<u32>;
@group(0) @binding(${B.half}) var halfFactors:texture_storage_2d<${DFSH_HALF_FORMAT},write>;
@group(0) @binding(${B.flags}) var surfaceFlags:texture_2d<u32>;
fn dfshTraceTile(position:vec3f,depth:f32,tile:vec2i,density:f32)->f32{
 let at=u32(tile.y)*dfsh.tiles.x+u32(tile.x);
 let start=tileOffsets[at];
 let count=min(tileCounts[at],dfsh.tiles.y-min(start,dfsh.tiles.y));
 let rayStart=position+dfsh.light.xyz*(2.0+dfsh.trace.y*depth);
 let rayEnd=position+dfsh.light.xyz*dfsh.trace.x;
 var visibility=1.0;
 for(var k=0u;k<count&&visibility>0.0;k++){
  visibility=dfshTraceObject(tileData[start+k],rayStart,rayEnd,dfsh.light.w,visibility,density);
  if(visibility<0.01){visibility=0.0;}
 }
 return visibility;
}
@compute @workgroup_size(${DFSH_TILE},${DFSH_TILE})
fn dfshTrace(@builtin(global_invocation_id) id:vec3u){
 let down=dfsh.view.z;
 let size=(dfsh.view.xy+vec2u(down-1u))/down;
 if(any(id.xy>=size)){return;}
 let top=vec2i(id.xy*down);
 let last=vec2i(dfsh.view.xy)-vec2i(1);
 let z=hizOpaqueDepth(top);
 var farthest=z;
 for(var k=1u;k<down*down;k++){
  farthest=min(farthest,hizOpaqueDepth(min(top+vec2i(i32(k%down),i32(k/down)),last)));
 }
 let depth=dfshDepthCm(z);
 var visibility=1.0;
 if(dfshDepthCm(farthest)>dfsh.range.x&&depth<dfsh.range.y){
  let position=dfshPosition(pixelToNdc(vec2f(top)+vec2f(0.5),vec2f(dfsh.view.xy)),z);
  let tile=dfshTileOf(position);
  let thin=(textureLoad(surfaceFlags,top,0).r&${SUBSURFACE_FLAG}u)!=0u;
  if(tile.x>=0){visibility=dfshTraceTile(position,depth,tile,select(0.0,dfsh.trace.w,thin));}
 }
 textureStore(halfFactors,vec2u(id.x,dfsh.view.w*size.y+id.y),vec4f(visibility,depth,0.0,0.0));
}`,
  [
    DFSH_COMMON_WGSL,
    meshFieldWgsl(0, B.objects),
    hizDepthWgsl(0, B.depth),
    pixelToNdc,
    DFSH_TRACE_OBJECT_WGSL,
  ],
)
