import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { meshFieldWgsl } from '../meshFieldWgsl.ts'
import { dfshCommonWgsl } from './commonWgsl.ts'
import { DFSH_BINDING as B, DFSH_MAX_CONE_RADIUS } from './layout.ts'

/** The span of a line through a box, saturated. */
const DFSH_LINE_BOX_WGSL = `
fn dfshLineBox(origin:vec3f,end:vec3f,boxMin:vec3f,boxMax:vec3f)->vec2f{
 let inverse=1.0/(end-origin);
 let first=(boxMin-origin)*inverse;
 let second=(boxMax-origin)*inverse;
 let farthest=max(first,second);
 let closest=min(first,second);
 return saturate(vec2f(max(closest.x,max(closest.y,closest.z)),min(farthest.x,min(farthest.y,farthest.z))));
}`

/** The cone traced through one mesh's field: its visibility along the ray. */
const DFSH_TRACE_CONE_WGSL = `fn dfshTraceCone(object:u32,rayStart:vec3f,rayEnd:vec3f,tanAngle:f32,minRadiusCm:f32,expandSurface:bool,visibilityIn:f32)->f32{
 var visibility=visibilityIn;
 let data=loadDfObjectData(object);
 let volumeStart=dfWorldToVolume(data,dfshWorld(rayStart));
 let volumeEnd=dfWorldToVolume(data,dfshWorld(rayEnd));
 var direction=volumeEnd-volumeStart;
 let rayLength=length(direction);
 direction=direction/rayLength;
 let toVolume=1.0/max(data.toWorldScale.x,max(data.toWorldScale.y,data.toWorldScale.z));
 let minRadius=minRadiusCm*toVolume;
 var maxRadius=${DFSH_MAX_CONE_RADIUS}.0*toVolume;
 let selfShadowScale=1.0/max(data.selfShadowBias*toVolume,0.0001);
 let coneAtObject=min(tanAngle*max(dot(-volumeStart,direction),0.0),maxRadius);
 let times=dfshLineBox(volumeStart,volumeEnd,-data.extent-vec3f(coneAtObject),data.extent+vec3f(coneAtObject));
 if(times.x>=times.y){return visibility;}
 let mips=dfAssetMip(data.asset,0u).numMips;
 let asset=dfAssetMip(data.asset,mips-1u);
 let expand=data.surfaceBias*(exp2(f32(DF_MAX_MIPS)-f32(mips))+select(0.0,dfsh.range.z-1.0,data.mostlyTwoSided));
 var maxEncoded=asset.scaleBias.x+asset.scaleBias.y;
 if(expandSurface||data.mostlyTwoSided){maxEncoded-=expand;}
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
  if(expandSurface||data.mostlyTwoSided){field-=expand*saturate(time/max(2.0*expand,1e-6));}
  let selfShadow=1.0-saturate(time*selfShadowScale);
  let radius=clamp(tanAngle*time,minRadius,maxRadius);
  var share=max(saturate(field/radius),selfShadow);
  visibility=min(visibility,share);
  time+=max(abs(field),minStep);
  if(visibility<0.01||time>endTime){
   stopped=iteration;
   break;
  }
 }
 return min(visibility,1.0-f32(stopped)/f32(maxSteps));
}`

/**
 * THE RAY OF A POINT THROUGH A MESH'S FIELD (`dfshTraceCone`), the visibility it leaves `visibility`
 * at the least of: the ray, from the surface toward the sun, is taken into the mesh's volume and
 * clipped to its box grown by the cone's radius at the mesh (the tangent of the sun's angle over the
 * distance along the ray to the mesh's centre, at most the widest cone radius); each step reads the
 * field at the sample held to the box (the distance to the box added to the field's), the visibility
 * of the step the share of the cone's radius there (held between the narrowest and the widest) the
 * distance covers, at least the mesh's self-shadow ramp; the next step is that distance, or a
 * quarter of the steps' count's inverse at least; the ray stops when fully occluded or past the
 * box, and as it nears the last step it is forced toward shadow. A two-sided mesh has its surface
 * expanded, by its bias times the share of the ray that has gone, over twice the bias.
 */
export const dfshTraceObjectWgsl = (group = 0, suns = 0) =>
  wgslBlock(
    `DFSH_TRACE_OBJECT_WGSL ${group} ${suns}`,
    [dfshCommonWgsl(group, suns), meshFieldWgsl(group, B.objects)],
    [DFSH_LINE_BOX_WGSL, DFSH_TRACE_CONE_WGSL].join('\n'),
  )
