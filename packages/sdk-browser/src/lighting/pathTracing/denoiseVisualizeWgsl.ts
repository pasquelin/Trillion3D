import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { FULLSCREEN_VERTEX } from '../../gpu/shader/fullscreenTriangle.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { DN_SAMPLING_WGSL } from './denoiseColorWgsl.ts'

export const DN_VISUALIZE_ENTRIES = {
  motion: 'dnVisualizeMotion',
  warp: 'dnVisualizeWarp',
} as const

const VIEW = wgslBlock(
  'DN_VISUALIZE_VIEW_WGSL',
  [FULLSCREEN_VERTEX, DN_SAMPLING_WGSL],
  `struct DnVisualView{bufferSize:vec2f,rectMin:vec2f,preExposure:f32,spare0:f32,spare1:f32,spare2:f32}
@group(0) @binding(0) var<uniform> dnView:DnVisualView;
@group(0) @binding(1) var dnMotion:texture_2d<f32>;
@group(0) @binding(2) var dnHistory:texture_2d<f32>;
fn dnHsvSmooth(c:vec3f)->vec3f{
 var rgb=clamp(abs((vec3f(c.x*6.0)+vec3f(0.0,4.0,2.0))%vec3f(6.0)-vec3f(3.0))-vec3f(1.0),vec3f(0.0),vec3f(1.0));
 rgb=rgb*rgb*(vec3f(3.0)-2.0*rgb);
 return c.z*mix(vec3f(1.0),rgb,c.y);
}
fn dnWheel(direction:vec2f,strength:f32)->vec3f{
 var h=atan2(direction.y,-direction.x)/3.1415927;
 h=select(h/2.0,(h+2.0)/2.0,h<0.0);
 return dnHsvSmooth(vec3f(h,1.0,pow(strength,1.0/2.2)));
}`,
)

const MOTION_WGSL = `@fragment
fn ${DN_VISUALIZE_ENTRIES.motion}(@builtin(position) at:vec4f)->@location(0) vec4f{
 let texel=vec2i(at.xy-dnView.rectMin);
 let velocity=textureLoad(dnMotion,texel,0);
 var colour=vec3f(0.0);
 if(length(velocity.xy)>=0.001){
  colour=pow(dnWheel(velocity.xy,clamp(length(velocity.xy),0.0,50.0)/50.0),vec3f(select(velocity.z,1.0,velocity.z==0.0)));
 }
 let meter=50.0;
 let local=vec2f(texel)-vec2f(meter);
 if(length(local)<meter){colour=dnWheel(-local,length(local)/meter);}
 let grid=32;
 let centre=(texel/grid)*grid+vec2i(grid/2);
 let direction=-textureLoad(dnMotion,centre,0).xy;
 let here=vec2f(texel);
 let origin=vec2f(centre);
 let lineColour=vec3f(0.7);
 let along=here-origin;
 let len=length(direction);
 if(len>0.0001){
  let unit=direction/len;
  let across=vec2f(direction.y,-direction.x)/len;
  let onLine=dot(-unit,along)+len;
  let thickness=1.0+fract(onLine/8.0)*8.0*0.25;
  let mask=clamp(thickness-abs(dot(across,along)),0.0,1.0)*clamp(len-length(along),0.0,1.0);
  colour=mix(colour,lineColour,mask);
 }
 let dist=length(origin-direction-here);
 colour=mix(colour,lineColour,clamp(3.0-dist,0.0,1.0));
 colour=mix(colour,vec3f(0.0),clamp(1.5-dist,0.0,1.0));
 return vec4f(colour,1.0);
}`

const WARP_WGSL = `@fragment
fn ${DN_VISUALIZE_ENTRIES.warp}(@builtin(position) at:vec4f)->@location(0) vec4f{
 let texel=vec2i(at.xy-dnView.rectMin);
 let velocity=textureLoad(dnMotion,texel,0);
 let extent=vec2f(textureDimensions(dnHistory,0));
 let uv=(vec2f(texel)+velocity.xy+vec2f(0.5)+dnView.rectMin)/extent;
 let history=dnBicubic(dnHistory,0,uv,extent);
 return vec4f(history.rgb*dnView.preExposure,1.0);
}`

/** The two views that draw the temporal stage over the image: the motion found (a colour wheel by direction and length, a grid of arrows, a wheel in the corner) and the history warped by it. */
export const DN_VISUALIZE_PROGRAMS = {
  motion: wgslProgram(MOTION_WGSL, [VIEW]),
  warp: wgslProgram(WARP_WGSL, [VIEW]),
} as const
