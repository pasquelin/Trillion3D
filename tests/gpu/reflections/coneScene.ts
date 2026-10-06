// The analytic scene the reflection cone proof traces (`reflection-cone.gpu.ts`): an orthographic
// view of the plane at depth 0.2, 64 pixels square, whose radiance ramps along x and whose white
// channel is one; the receivers stand before it (a greater depth, the clear depth being zero) and
// their rays run away from the eye, crossing it from before to behind as a walk answers. Only the
// host functions the shipped walks read are the proof's — the projection, the depth and its bounds
// pyramid, the hit and each mip level's colour, as the WebGPU adapter defines them on textures
// (`screenWgsl.ts`, `coneWgsl.ts`); the walks, the cone and the bands are the engine's text.
import { reflectionBandsShader } from '../../../packages/sdk-browser/src/reflections/bandsShader.ts'
import { screenTraceShader } from '../../../packages/sdk-browser/src/reflections/traceShader.ts'
import { reflectionConeShader } from '../../../packages/sdk-browser/src/reflections/coneShader.ts'
import { reflectionConeFilterShader } from '../../../packages/sdk-browser/src/reflections/coneFilterShader.ts'

/** The image's side, in pixels, and its mip levels above the pixels: 32, 16, … 1. */
const SIDE = 64
const LEVELS = Math.log2(SIDE)

/** Rows the proof dispatches, one invocation each: what each row traces is read in `main`. */
export const CONE_ROWS = 75

export const CONE_SCENE_WGSL = `
fn reflectionProject(p:vec4f)->vec4f{return p;}
fn reflectionSize()->vec2f{return vec2f(${SIDE}.0);}
fn reflectionLastMip()->f32{return ${LEVELS}.0;}
fn reflectionBoundsLevels()->i32{return ${LEVELS};}
fn reflectionClearDepth()->f32{return 0.0;}
fn reflectionDepthAt(p:vec2i)->f32{return 0.2;}
fn reflectionHitAt(p:vec2i)->vec4f{return vec4f(1.0,(f32(p.x)+0.5)/${SIDE}.0,0.0,1.0);}
fn reflectionBoundsAt(p:vec2i,level:i32)->vec2f{return vec2f(0.2);}
fn reflectionMipColorAt(p:vec2i,level:i32)->vec4f{
 return vec4f(1.0,(f32(p.x)+0.5)*exp2(f32(level))/${SIDE}.0,f32(level),1.0);
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
 // The receiver's normal across the view, its plane seen edge on: the cone's receiver test
 // (\`reflectionReceiverPlane\`) then rejects no cell, and the cone integrates the plane alone.
 let N=vec3f(sign(R.x),0.0,0.0);
 control[index]=vec4u(index,arrayLength(&output),1u,0u);
 var value=vec4f(0.0);
 if(index==0u){value=screenReflection(P,R);}
 if((index>=1u&&index<=5u)||index>=11u){value=screenReflectionCone(P,N,R,inputs[index*2u].w);}
 if(index==6u){value=vec4f(reflectionConeSlope(0.2),reflectionConeSlope(0.5),reflectionConeSlope(1.0),0.0);}
 if(index>=7u&&index<11u){
  let roughs=array<f32,4>(0.1,0.5,0.8,1.0);
  value=vec4f(reflectionProbeBands(roughs[index-7u]),0.0);
 }
 output[index]=value;
 control[index].w=1u;
}`

/** The rows that do not trace row 1's receiver: 3 exits the view, 4 lies nearer the plane, 5 mirrors
 *  row 1's direction across x. */
const RECEIVERS: Record<number, number[]> = {
  3: [0.9, 0, 0.8],
  4: [-0.8, 0, 0.4],
  5: [0.8, 0, 0.8],
}

/** Each row's receiver and reflected direction, eight floats: the point and its roughness, the
 *  direction. */
export function coneRows() {
  const data = new Float32Array(CONE_ROWS * 8)
  for (let row = 0; row < CONE_ROWS; row++)
    data.set(
      [...(RECEIVERS[row] ?? [-0.8, 0, 0.8]), 0.5, row === 5 ? -0.8 : 0.8, 0, -0.6, 0],
      row * 8,
    )
  return data
}
