import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { CLOUD_SHADOW_FORMAT, CLOUD_SHADOW_GROUP_SIZE } from './shadowLayout.ts'
import { CLOUD_SHADOW_ROUND } from './shadowWgsl.ts'
import { fieldLayout } from '../../../gpu/core/fieldLayout.ts'

/** Where the filter binds what it reads and writes, in its own group 0. */
export const SKY_OCCLUSION_FILTER_BINDING = {
  source: 0,
  sampler: 1,
  block: 2,
  destination: 3,
} as const

/** The filter's block: the map's side in texels twice, then their inverses (`size`); a texel's
 *  side in centimetres twice, then their inverses (`texelWorld`); the layer's base altitude in
 *  centimetres, the aperture's multiplier and its addend (`aperture`). */
export const SKY_OCCLUSION_FILTER_LAYOUT = fieldLayout('SkyOcclusionFilterBlock', [
  ['size', 'vec4f'],
  ['texelWorld', 'vec4f'],
  ['aperture', 'vec4f'],
] as const)

/**
 * THE SKY OCCLUSION'S FILTER, one thread to a texel, the map written the size of the map read: not
 * a blur of the map but an integration over the hemisphere above the ground. It does not take the
 * planet's curvature into account.
 *
 * 4 by 4, 16 directions of the hemisphere, uniformly, averaged over 16: with `k` from 0 to 3 the first coordinate is
 * `(k + 0.125) / 4`, the second `add + mul * ((k + 0.125) / 4)`, with `mul` the aperture scale and
 * `add` its complement to 1, so that only a cone round the vertical is taken for an aperture under
 * 1. A direction `d` reads the map, bilinearly, at the texel's centre moved by `d.xy` times the
 * layer's base altitude over `d.z`, in texels. The depth and the mean extinction are averaged; the
 * optical depth is the one whose transmittance is the mean of the transmittances (the visibility is
 * what integrates over the hemisphere, not the extinction), 100 where that is 0. The result is rounded to the 11/11/10 bit float grid as the trace's is.
 */
export const SKY_OCCLUSION_FILTER_PROGRAM = wgslProgram(
  `${SKY_OCCLUSION_FILTER_LAYOUT.wgsl}
@group(0) @binding(${SKY_OCCLUSION_FILTER_BINDING.source}) var source:texture_2d<f32>;
@group(0) @binding(${SKY_OCCLUSION_FILTER_BINDING.sampler}) var bilinear:sampler;
@group(0) @binding(${SKY_OCCLUSION_FILTER_BINDING.block}) var<uniform> filterBlock:SkyOcclusionFilterBlock;
@group(0) @binding(${SKY_OCCLUSION_FILTER_BINDING.destination}) var destination:texture_storage_2d<${CLOUD_SHADOW_FORMAT},write>;
fn uniformHemisphere(e:vec2f)->vec3f{
 let phi=6.283185307179586*e.x;
 let cosTheta=e.y;
 let sinTheta=sqrt(1.0-cosTheta*cosTheta);
 return vec3f(sinTheta*cos(phi),sinTheta*sin(phi),cosTheta);
}
@compute @workgroup_size(${CLOUD_SHADOW_GROUP_SIZE},${CLOUD_SHADOW_GROUP_SIZE},1)
fn skyOcclusionFilterMain(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=u32(filterBlock.size.x)||id.y>=u32(filterBlock.size.y)){return;}
 let centre=(vec2f(id.xy)+0.5)*filterBlock.size.zw;
 var depth=0.0;
 var extinction=0.0;
 var transmittance=0.0;
 for(var u=0.125;u<4.0;u+=1.0){
  for(var v=0.125;v<4.0;v+=1.0){
   let zetaV=filterBlock.aperture.y+filterBlock.aperture.x*(v/4.0);
   let dir=uniformHemisphere(vec2f(u/4.0,zetaV));
   let world=dir.xy*filterBlock.aperture.z/max(0.0000001,dir.z);
   let data=textureSampleLevel(source,bilinear,centre+world*filterBlock.texelWorld.zw*filterBlock.size.zw,0.0).xyz;
   depth+=data.x;
   extinction+=data.y;
   transmittance+=exp(-data.z);
  }
 }
 let count=16.0;
 let opticalDepth=select(100.0,-log(transmittance/count),transmittance>0.0);
 textureStore(destination,id.xy,cloudShadowStore(vec3f(depth/count,extinction/count,opticalDepth)));
}`,
  [CLOUD_SHADOW_ROUND],
)
export const SKY_OCCLUSION_FILTER_ENTRY = 'skyOcclusionFilterMain'
