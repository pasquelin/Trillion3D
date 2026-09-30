import { FULLSCREEN_VERTEX } from '../lighting/deferred/shaders.ts';
import { taaReprojectWgsl } from '../taa/shaderWgsl.ts';
import { PAGE_INFO_STRUCT_WGSL } from '../visibility/shader/pageWgsl.ts';
import { REFLECTION_PHASE_WGSL } from './hizTraceWgsl.ts';

/** A bounded effective weight, not an unbounded Monte Carlo counter. At this
 * scale binary16 has 1/32 weight spacing; RGB arithmetic remains binary32. */
export const REFLECTION_HISTORY_WEIGHT = 64;
/** The weight a history keeps while its sources or camera move: a reflection lags them by about
 *  this many samples, four a frame (`roughSamples`), never the still window's sixty-four. */
export const REFLECTION_MOVING_WEIGHT = 16;
export const REFLECTION_RESOLVE_VIEW_BYTES = 160;

/** Dedicated ratio-estimator resolve. It shares only reprojection mathematics
 * with TAA: no neighbourhood clamp, colour transform or TAA history is involved.
 * The trace ran at half resolution, each texel for one pixel of its 2 × 2 block
 * (`reflectionPhase`): a pixel takes the four texels around it whose pixel is on
 * its receiver with its lobe, the reference's ray reuse. History follows the
 * placement motion (`params.z`) and is dropped only where its receiver, normal
 * or depth disagree; `params.y` caps its weight, `params.w` the trace seed's low bits. */
export const REFLECTION_RESOLVE_WGSL = `
${FULLSCREEN_VERTEX}
${PAGE_INFO_STRUCT_WGSL}
struct ReflectionResolveView{prevViewProj:mat4x4f,invViewProj:mat4x4f,viewport:vec4f,params:vec4f,}
@group(0) @binding(0) var sampleColor:texture_2d<f32>;
@group(0) @binding(1) var historyColor:texture_2d<f32>;
@group(0) @binding(2) var depth:texture_depth_2d;
@group(0) @binding(3) var normalRough:texture_2d<f32>;
@group(0) @binding(4) var ids:texture_2d<u32>;
@group(0) @binding(5) var previousDepth:texture_depth_2d;
@group(0) @binding(6) var previousNormal:texture_2d<f32>;
@group(0) @binding(7) var previousIds:texture_2d<u32>;
@group(0) @binding(8) var<uniform> view:ReflectionResolveView;
@group(0) @binding(9) var<storage,read> pages:array<PageInfo>;
@group(0) @binding(10) var<storage,read> motion:array<mat4x4f>;
${taaReprojectWgsl(false)}
${REFLECTION_PHASE_WGSL}
fn roughSamples(at:vec2i,id:u32,nr:vec4f)->vec4f{
 let drawn=vec2i(view.viewport.xy);let half=vec2i((drawn+vec2i(1))/2);
 let phase=reflectionPhase(u32(view.params.w));
 let base=vec2i(max(at-vec2i(1),vec2i(0))/2);
 var sum=vec4f(0.0);
 for(var k=0;k<4;k++){
  let q=base+vec2i(k&1,k>>1u);
  if(any(q>=half)){continue;}
  let traced=textureLoad(sampleColor,q,0);
  if(traced.a<=0.0){continue;}
  let owner=min(q*2+phase,drawn-vec2i(1));
  if(any(owner!=at)){
   if(textureLoad(ids,owner,0).r!=id){continue;}
   let other=textureLoad(normalRough,owner,0);
   if(dot(other.xyz,nr.xyz)<0.99||abs(other.a-nr.a)>0.001){continue;}
  }
  sum+=vec4f(traced.rgb*traced.a,traced.a);
 }
 if(sum.a<=0.0){return vec4f(0.0);}
 return vec4f(sum.rgb/sum.a,sum.a);
}
@fragment fn resolveRoughReflection(@builtin(position) pixel:vec4f)->@location(0) vec4f{
 let at=vec2i(pixel.xy);let id=textureLoad(ids,at,0).r;
 let z=textureLoad(depth,at,0);let nr=textureLoad(normalRough,at,0);
 let ndc=vec2f(pixel.x*view.viewport.z*2.0-1.0,1.0-pixel.y*view.viewport.w*2.0);
 var position=view.invViewProj*vec4f(ndc,z,1.0);
 var normal=nr.xyz;
 if(view.params.z!=0.0&&id!=0u){
  let moved=motion[placementOf(id)];
  position=moved*position;normal=(moved*vec4f(normal,0.0)).xyz;
 }
 let projected=view.prevViewProj*position;
 let expected=projected.z/projected.w;
 let tolerance=max(abs(dpdx(expected))+abs(dpdy(expected)),1e-7);
 if(id==0u){return vec4f(0.0);}
 let current=roughSamples(at,id,nr);
 var history=vec4f(0.0);
 let uv=previousUv(at,z,at);
 if(view.params.x!=0.0&&uv.z!=0.0){
  let prior=vec2i(uv.xy*view.viewport.xy);
  let oldId=textureLoad(previousIds,prior,0).r;
  let oldNormal=textureLoad(previousNormal,prior,0);
  // Reject a different receiver, material lobe or shading normal before any mean is read.
  if(oldId==id&&dot(oldNormal.xyz,normal)>0.999&&abs(oldNormal.a-nr.a)<=0.001){
   let oldDepth=textureLoad(previousDepth,prior,0);
   if(abs(oldDepth-expected)<=tolerance){history=textureLoad(historyColor,prior,0);}
  }
 }
 let kept=min(history.a,view.params.y);
 let total=kept+current.a;
 if(total<=0.0){return vec4f(0.0);}
 let mean=history.rgb+(current.rgb-history.rgb)*(current.a/total);
 return vec4f(mean,min(total,${REFLECTION_HISTORY_WEIGHT}.0));
}`;

export function reflectionResolveLayout(device: GPUDevice) {
  const visibility = GPUShaderStage.FRAGMENT;
  return device.createBindGroupLayout({
    entries: [
      ...Array.from({ length: 8 }, (_, binding) => ({
        binding,
        visibility,
        texture: {
          sampleType: (binding === 2 || binding === 5
            ? 'depth'
            : binding === 4 || binding === 7
              ? 'uint'
              : 'unfilterable-float') as GPUTextureSampleType,
        },
      })),
      { binding: 8, visibility, buffer: { type: 'uniform' } },
      { binding: 9, visibility, buffer: { type: 'read-only-storage' } },
      { binding: 10, visibility, buffer: { type: 'read-only-storage' } },
    ],
  });
}
