import { reflectionBandsShader } from '../../../packages/sdk-browser/src/reflections/environmentShader.ts';
import { screenTraceShader } from '../../../packages/sdk-browser/src/reflections/traceShader.ts';
import { reflectionConeShader } from '../../../packages/sdk-browser/src/reflections/coneShader.ts';
import { reflectionConeFilterShader } from '../../../packages/sdk-browser/src/reflections/coneFilterShader.ts';

/** Analytic orthographic scene: plane z=.8 with a linear radiance ramp and white channel. */
export const CONE_DIAGNOSTIC_WGSL = `
fn reflectionProject(p:vec4f)->vec4f{return p;}
fn reflectionSize()->vec2f{return vec2f(64.0);}
fn reflectionLastMip()->f32{return 6.0;}
fn reflectionClearDepth()->f32{return 0.0;}
fn reflectionDepthAt(p:vec2i)->f32{return 0.8;}
fn reflectionColorAt(p:vec2i)->vec3f{return vec3f(1.0,(f32(p.x)+0.5)/64.0,0.0);}
fn reflectionBoundsAt(p:vec2i,level:i32)->vec2f{return vec2f(0.8);}
fn reflectionMipColorAt(p:vec2i,level:i32)->vec4f{
 return vec4f(1.0,(f32(p.x)+0.5)*exp2(f32(level))/64.0,f32(level),1.0);
}
${screenTraceShader('wgsl')}
${reflectionConeFilterShader('wgsl')}
${reflectionConeShader('wgsl')}
${reflectionBandsShader('wgsl')}
@group(0) @binding(0) var<storage,read_write> output:array<vec4f>;
@group(0) @binding(1) var<storage,read> inputs:array<vec4f>;
@group(0) @binding(2) var<storage,read_write> control:array<vec4u>;
@compute @workgroup_size(1) fn main(@builtin(global_invocation_id) id:vec3u){
 let index=id.x;let P=inputs[index*2u].xyz;let R=inputs[index*2u+1u].xyz;
 control[index]=vec4u(index,arrayLength(&output),1u,0u);
 var value=vec4f(0.0);
 if(index==0u){value=screenReflection(P,R);}
 if((index>=1u&&index<=5u)||index>=11u){value=screenReflectionCone(P,R,inputs[index*2u].w);}
 if(index==6u){value=vec4f(reflectionConeSlope(0.2),reflectionConeSlope(0.5),reflectionConeSlope(1.0),0.0);}
 if(index>=7u&&index<11u){
  let roughs=array<f32,4>(0.1,0.5,0.8,1.0);
  value=vec4f(reflectionProbeBands(roughs[index-7u]),0.0);
 }
 output[index]=value;
 control[index].w=1u;
}`;
