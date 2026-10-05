import { FULLSCREEN_VERTEX } from '../lighting/deferred/shaders.ts';
import { taaReprojectWgsl } from '../taa/shaderWgsl.ts';
import { oncePerDevice } from '../gpu/core/oncePerDevice.ts';
import { PAGE_INFO_STRUCT_WGSL } from '../visibility/shader/pageWgsl.ts';
import { PREVIOUS_DEPTH_WGSL } from './resolveWgsl.ts';

export const REFLECTION_SOURCE_VIEW_BYTES = 176;

/**
 * The reflection source without a second lighting pass: the last image's unfogged, mirror-free
 * colour, which its one lighting pass wrote beside the lit image (`sourceOutputWgsl.ts`), brought
 * to this image's pixels through the camera and the placement motion (`taaReprojectWgsl`, the
 * temporal pass's own). Alpha is 1 where the point was seen on the last image, 0 where it was not:
 * a first image (`params.x`), a point off the last one, a point hidden there (its depth is not the
 * one the history resolve expects, `previousDepthOf`) or, while a placement moved that no live
 * motion follows (`params.y`), a point the last image drew on another triangle. A trace reaching
 * such a pixel misses and reads the fallback, never another surface's colour.
 */
export const REFLECTION_SOURCE_WGSL = `
${FULLSCREEN_VERTEX}
${PAGE_INFO_STRUCT_WGSL}
struct ReflectionSourceView{prevViewProj:mat4x4f,invViewProj:mat4x4f,viewport:vec4f,params:vec4f,last:vec4f,}
@group(0) @binding(0) var lastImage:texture_2d<f32>;
@group(0) @binding(1) var lastSampler:sampler;
@group(0) @binding(2) var depth:texture_depth_2d;
@group(0) @binding(3) var ids:texture_2d<u32>;
@group(0) @binding(4) var<uniform> view:ReflectionSourceView;
@group(0) @binding(5) var<storage,read> pages:array<PageInfo>;
@group(0) @binding(6) var<storage,read> motion:array<mat4x4f>;
@group(0) @binding(7) var lastDepth:texture_depth_2d;
@group(0) @binding(8) var lastIds:texture_2d<u32>;
${taaReprojectWgsl(false)}
${PREVIOUS_DEPTH_WGSL}
@fragment fn reprojectReflectionSource(@builtin(position) pixel:vec4f)->@location(0) vec4f{
 let at=vec2i(pixel.xy);let z=textureLoad(depth,at,0);let id=textureLoad(ids,at,0).r;
 let expected=previousDepthOf(vec2i(pixel.xy),z,id);
 if(view.params.x==0.0||z==0.0){return vec4f(0.0);}
 let uv=previousUv(at,z,id);
 if(uv.z==0.0){return vec4f(0.0);}
 let prior=min(vec2i(uv.xy*view.last.xy),vec2i(view.last.xy)-vec2i(1));
 if(abs(textureLoad(lastDepth,prior,0)-expected.x)>expected.y){return vec4f(0.0);}
 if(view.params.y!=0.0&&textureLoad(lastIds,prior,0).r!=id){return vec4f(0.0);}
 return vec4f(textureSampleLevel(lastImage,lastSampler,uv.xy*view.last.xy*view.last.zw,0.0).rgb,1.0);
}`;

export const reflectionSourceLayout = oncePerDevice((device) => {
  const visibility = GPUShaderStage.FRAGMENT;
  return device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility, texture: { sampleType: 'float' } },
      { binding: 1, visibility, sampler: { type: 'filtering' } },
      { binding: 2, visibility, texture: { sampleType: 'depth' } },
      { binding: 3, visibility, texture: { sampleType: 'uint' } },
      { binding: 4, visibility, buffer: { type: 'uniform' } },
      { binding: 5, visibility, buffer: { type: 'read-only-storage' } },
      { binding: 6, visibility, buffer: { type: 'read-only-storage' } },
      { binding: 7, visibility, texture: { sampleType: 'depth' } },
      { binding: 8, visibility, texture: { sampleType: 'uint' } },
    ],
  });
});
