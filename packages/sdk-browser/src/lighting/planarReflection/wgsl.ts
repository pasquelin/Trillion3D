import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { PI } from '../../../../math/src/wgsl/constants.ts'
import { fieldLayout } from '../../gpu/core/fieldLayout.ts'
import { FULLSCREEN_VERTEX } from '../../gpu/shader/fullscreenTriangle.ts'
import { SCREEN_SPACE_SURFACE_WGSL } from '../screenSpaceTracing/rayCastWgsl.ts'
import { SCREEN_SPACE_GROUP } from '../screenSpaceTracing/screenSpaceView.ts'

/**
 * THE PROGRAMS OF A PLANAR REFLECTION: the prefilter that turns the mirrored view's lit image into the reflection image, and the composite that lays
 * that image over the reflection the opaque surfaces read.
 *
 * THE PREFILTER (`planarPrefilterMain`), one pixel of the reflection image at a time: the lit image of the mirrored view, blurred along the image's
 * vertical by a gaussian whose radius grows with the distance of the reflected surface behind the plane (up to `prefilter.kernel.x` pixels, reached at
 * `1 / prefilter.kernel.y` metres), the samples above the pixel refused where their surface lies more than twice as far behind the plane as the
 * pixel's own (the background the clip plane uncovered) and those outside the image; the sum divided by its weights. The alpha it writes is the share
 * of the kernel that held a drawn surface: the image carries no alpha of its own, so a sample counts as drawn where its depth is (the sky
 * is left to the sky light, which holds it). Two texels are read at a time with one bilinear fetch where the samples are all accepted. The distance
 * to the plane is measured along the view depth (the reference measures it along the ray against a depth along the view: the two differ off the
 * axis).
 *
 * THE COMPOSITE (`planarCompositeMain`), one pixel of the main view at a time: the fades of the distance to the plane, to the box's edges, of the
 * surface's angle to the plane and of its roughness; then the mirrored reflection direction off the surface's normal, a point of the sphere that
 * stands for the scene along it, projected with the mirrored view's projection and read from the image. The image is the mirrored view flipped left to
 * right (`mirror.ts`), so the horizontal is flipped back. The colour is laid over the reflection as the reference lays it (one, one minus
 * source alpha); the alpha is the largest of the two, or left alone where the reflection already holds the environment (`screen`).
 */

/** The block of the prefilter: the image's size, the lit image's, the kernel, the plane, and the mirrored camera's frame (its eye, axes and tangents). */
export const PLANAR_PREFILTER_LAYOUT = fieldLayout('PlanarPrefilterBlock', [
  ['size', 'vec4f'],
  ['source', 'vec4f'],
  ['kernel', 'vec4f'],
  ['plane', 'vec4f'],
  ['eye', 'vec4f'],
  ['right', 'vec4f'],
  ['up', 'vec4f'],
  ['forward', 'vec4f'],
] as const)

/** The block of the composite: the plane, its origin and axes with their reaches, the fades, and the mirrored view's projection. */
export const PLANAR_COMPOSITE_LAYOUT = fieldLayout('PlanarCompositeBlock', [
  ['plane', 'vec4f'],
  ['origin', 'vec4f'],
  ['xAxis', 'vec4f'],
  ['yAxis', 'vec4f'],
  ['params', 'vec4f'],
  ['params2', 'vec4f'],
  ['projection', 'mat4x4f'],
] as const)

/** The binding of the composite's block in the screen-space group, past the inputs (`SCREEN_SPACE_BINDINGS`). */
export const PLANAR_COMPOSITE_BINDING = 13

const PREFILTER_TEXT = `${PLANAR_PREFILTER_LAYOUT.wgsl}
@group(0) @binding(0) var sceneColor:texture_2d<f32>;
@group(0) @binding(1) var sceneSampler:sampler;
@group(0) @binding(2) var sceneDepth:texture_depth_2d;
@group(0) @binding(3) var<uniform> prefilter:PlanarPrefilterBlock;
const PLANAR_FAR:f32=1.0e30;
fn planarDeviceDepth(uv:vec2f)->f32{
 return textureLoad(sceneDepth,vec2i(floor(uv*prefilter.source.xy)),0);
}
fn planarViewDepth(z:f32)->f32{return select(prefilter.kernel.z/z,PLANAR_FAR,z<=0.0);}
fn gaussianWeight1d(u:f32,radius:f32)->f32{
 let twoRadiusSq=2.0*radius*radius;
 return exp(-u*u/twoRadiusSq)/sqrt(PI*twoRadiusSq);
}
struct PlanarKernel{color:vec4f,weight:f32,}
fn verticalSample(uv:vec2f,y:f32,centerDistance:f32,centerReflection:f32,searchUp:bool,sum:ptr<function,PlanarKernel>){
 let radiusY=prefilter.kernel.x;
 let sampleUV=vec2f(uv.x,uv.y+y*prefilter.source.w);
 let sampleZ=planarDeviceDepth(sampleUV);
 let sampleReflection=max(planarViewDepth(sampleZ)-centerDistance,0.0);
 let scatter=max(radiusY*saturate(sampleReflection*prefilter.kernel.y),1.0);
 var weight=gaussianWeight1d(y,scatter);
 var halfTexel=0.5*prefilter.source.w;
 let yPosition=uv.y*prefilter.source.y+y;
 if(searchUp){
  // Not from pixels much further than the mirror reflection depth: the background the clip plane uncovered. No bilinear filtering where the depth masks.
  weight*=select(0.0,1.0,sampleReflection<centerReflection*2.0);
  halfTexel=0.0;
  weight*=select(0.0,1.0,yPosition>0.5);
 }else{
  weight*=select(0.0,1.0,yPosition<prefilter.size.y-0.5);
 }
 var color=textureSampleLevel(sceneColor,sceneSampler,sampleUV+vec2f(0.0,halfTexel),0.0);
 color.a=select(0.0,1.0,sampleZ<=0.0);
 (*sum).color+=-min(-color,vec4f(0.0))*weight;
 (*sum).weight+=weight;
}
@fragment fn planarPrefilterMain(@builtin(position) at:vec4f)->@location(0) vec4f{
 let uv=min(at.xy*prefilter.source.zw,(prefilter.size.xy-vec2f(0.5))*prefilter.source.zw);
 let radiusY=prefilter.kernel.x;
 if(radiusY>0.0){
  let ndc=vec2f(at.x*prefilter.size.z*2.0-1.0,1.0-at.y*prefilter.size.w*2.0);
  let screenVector=prefilter.forward.xyz+prefilter.right.xyz*(ndc.x*prefilter.eye.w)+prefilter.up.xyz*(ndc.y*prefilter.right.w);
  let facing=dot(screenVector,prefilter.plane.xyz);
  let centerDistance=select(PLANAR_FAR,-(dot(prefilter.eye.xyz,prefilter.plane.xyz)-prefilter.plane.w)/facing,abs(facing)>1.0e-6);
  let centerReflection=max(planarViewDepth(planarDeviceDepth(uv))-centerDistance,0.0);
  var sum=PlanarKernel(vec4f(0.0),0.0);
  for(var y=0.0;y<radiusY;y+=2.0){verticalSample(uv,y,centerDistance,centerReflection,false,&sum);}
  for(var y=-2.0;y>-radiusY;y-=2.0){verticalSample(uv,y,centerDistance,centerReflection,true,&sum);}
  let color=sum.color/max(sum.weight,0.0001);
  return vec4f(color.rgb,1.0-color.a);
 }
 let color=textureSampleLevel(sceneColor,sceneSampler,uv,0.0);
 return vec4f(color.rgb,select(1.0,0.0,planarDeviceDepth(uv)<=0.0));
}`

const COMPOSITE_TEXT = `${PLANAR_COMPOSITE_LAYOUT.wgsl}
@group(${SCREEN_SPACE_GROUP}) @binding(${PLANAR_COMPOSITE_BINDING}) var<uniform> planar:PlanarCompositeBlock;
// The reflection image's share of a pixel: the colour and, in alpha, how far the pixel reads it.
fn planarReflection(P:vec3f,N:vec3f,rough:f32)->vec4f{
 let n=planar.plane.xyz;
 let planeDistance=dot(n,P)-planar.plane.w;
 var fade=1.0-saturate(abs(planeDistance)*planar.params.x+planar.params.y);
 let fromOrigin=P-planar.origin.xyz;
 fade*=saturate((planar.xAxis.w-abs(dot(fromOrigin,planar.xAxis.xyz)))*planar.params.x);
 fade*=saturate((planar.yAxis.w-abs(dot(fromOrigin,planar.yAxis.xyz)))*planar.params.x);
 let angleFade=saturate(dot(n,N)*planar.params2.x+planar.params2.y);
 let roughFade=1.0-saturate((rough-0.2)*10.0);
 var finalFade=fade*angleFade*roughFade;
 if(finalFade<=0.0){return vec4f(0.0);}
 // The view vector of the main view reflected into the mirrored space, then off the surface's normal in that space.
 let mirroredCamera=reflect(ssCameraVector(P),-n);
 let mirroredNormal=N-2.0*dot(n,N)*n;
 let mirroredOffNormal=reflect(mirroredCamera,mirroredNormal);
 // The point of the sphere that stands for the scene along it, in the main view's space, projected with the projection the image was drawn with.
 let viewPoint=(ssView.worldToView*vec4f(P+mirroredOffNormal*planar.params.z,1.0)).xyz;
 let clip=planar.projection*vec4f(viewPoint.x,viewPoint.y,-viewPoint.z,1.0);
 if(clip.w<=0.0){return vec4f(0.0);}
 var ndc=clamp(clip.xy/clip.w,vec2f(-1.0),vec2f(1.0));
 // The image is the mirrored view flipped left to right.
 ndc.x=-ndc.x;
 let seen=textureSampleLevel(colorImage,colorSampler,ndc*vec2f(0.5,-0.5)+vec2f(0.5),0.0);
 // Fade out where the image was not written, so the other reflections show there.
 finalFade*=seen.a;
 return vec4f(seen.rgb*roughFade,finalFade);
}
@fragment fn planarCompositeMain(@builtin(position) at:vec4f)->@location(0) vec4f{
 let pixel=vec2i(at.xy);
 let z=hizOpaqueDepth(pixel);
 let surface=ssSurfaceAt(pixel);
 // Skip the sky and the unlit pixels.
 if(ssFarDepth(z)||!surface.valid){discard;}
 let P=ssWorldAt(ssScreenOfPixel(vec2f(pixel)+vec2f(0.5)),z);
 let result=planarReflection(P,surface.N,surface.roughness);
 if(result.a<=0.0){discard;}
 return result;
}`

/** The prefilter's program: entry `planarPrefilterMain` over the full-screen triangle (`fullscreen`). */
export const PLANAR_PREFILTER_CODE = wgslProgram(PREFILTER_TEXT, [PI, FULLSCREEN_VERTEX])
/** The composite's program: entry `planarCompositeMain` over the full-screen triangle (`fullscreen`). */
export const PLANAR_COMPOSITE_CODE = wgslProgram(COMPOSITE_TEXT, [
  SCREEN_SPACE_SURFACE_WGSL,
  FULLSCREEN_VERTEX,
])
export const PLANAR_PREFILTER_ENTRY = 'planarPrefilterMain'
export const PLANAR_COMPOSITE_ENTRY = 'planarCompositeMain'
