import { FULLSCREEN_VERTEX } from '../lighting/deferred/shaders.ts';
import { taaReprojectWgsl } from '../taa/shaderWgsl.ts';
import { PAGE_INFO_STRUCT_WGSL } from '../visibility/shader/pageWgsl.ts';

/** A bounded effective weight, not an unbounded Monte Carlo counter. At this
 * scale binary16 has 1/32 weight spacing; RGB arithmetic remains binary32. */
export const REFLECTION_HISTORY_WEIGHT = 64;
/** The confidence a history keeps across a change of what it reflects (#33): a moved, relit or newly
 *  resident source leaves its stale share at 4/5 per frame, halved in three frames, while a moving
 *  view, which changes shadow pages and probes every frame, still averages five samples rather
 *  than restarting from one, which flickers. */
export const REFLECTION_CHANGE_WEIGHT = 4;
/** Frames a changed source keeps the change weight: its stale share falls to (4/5)^24 < 1/200,
 *  and the window's 64 samples after it dilute that below 1/2000, under a 1/255 step: a held
 *  image keeps nothing of what a reflection showed before (#33). */
export const REFLECTION_CHANGE_FRAMES = 24;
export const REFLECTION_RESOLVE_VIEW_BYTES = 160;

/** Dedicated ratio-estimator resolve. It shares only reprojection mathematics
 * with TAA: no neighbourhood clamp, colour transform or TAA history is involved.
 * `params`: x whether a history exists, y the confidence it may keep — the full window, or
 * `REFLECTION_CHANGE_WEIGHT` once a scene/source change reached objects seen in a reflection,
 * which stands for placement motion: the caller disables that branch of the reprojection. */
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
@fragment fn resolveRoughReflection(@builtin(position) pixel:vec4f)->@location(0) vec4f{
 let at=vec2i(pixel.xy);let id=textureLoad(ids,at,0).r;
 let current=textureLoad(sampleColor,at,0);
 let z=textureLoad(depth,at,0);let nr=textureLoad(normalRough,at,0);
 let ndc=vec2f(pixel.x*view.viewport.z*2.0-1.0,1.0-pixel.y*view.viewport.w*2.0);
 let projected=view.prevViewProj*(view.invViewProj*vec4f(ndc,z,1.0));
 let expected=projected.z/projected.w;
 let tolerance=max(abs(dpdx(expected))+abs(dpdy(expected)),1e-7);
 if(id==0u){return vec4f(0.0);}
 var history=vec4f(0.0);
 let uv=previousUv(at,z,at);
 if(view.params.x!=0.0&&uv.z!=0.0){
  let prior=vec2i(uv.xy*view.viewport.xy);
  let oldId=textureLoad(previousIds,prior,0).r;
  let oldNormal=textureLoad(previousNormal,prior,0);
  // Reject a different receiver, material lobe or shading normal before any mean is read.
  if(oldId==id&&dot(oldNormal.xyz,nr.xyz)>0.999&&abs(oldNormal.a-nr.a)<=0.001){
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
