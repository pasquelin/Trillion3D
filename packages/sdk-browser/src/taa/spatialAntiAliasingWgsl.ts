import { FULLSCREEN_VERTEX } from '../lighting/deferred/shaders.ts'
import { TAA_VIEW_WGSL } from './bindingsWgsl.ts'
import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import { wgslBlock, wgslFn } from '../../../math/src/wgsl/decl.ts'
import { TILE_CLAMP_WGSL } from './tileWgsl.ts'

/** The least LDR luma contrast the anti-aliaser treats as an edge: below it a staircase is not
 *  visible and the browse would only move noise. */
export const SPATIAL_ANTI_ALIASER_MIN_LUMINANCE = 0.05
/** The offset in 4 bits per axis over a range of ±0.5 texel, seven steps each side: the zero
 *  code 8, a step of 0.5 / 7. */
const OFFSET_MASK = 15
const OFFSET_STEPS = 7
const OFFSET_ZERO = OFFSET_STEPS + 1
const OFFSET_SCALE = OFFSET_STEPS / 0.5
/** The anti-aliaser's word of no offset — the zero code on both axes — and no noise filtering:
 *  what it writes where it does not run, and its target holds where the level runs none
 *  (`analysis.ts`). */
export const ANTI_ALIAS_NEUTRAL = OFFSET_ZERO | (OFFSET_ZERO << 4)
/** The rejection's bit of a texel the anti-aliaser runs on (`rejectionWgsl.ts`). */
export const ANTI_ALIAS_BIT = 4

/** The Rec. 601 luma the spatial anti-aliaser measures in, both its browse and whether aliasing
 *  is visible at all. */
export const LUMA_601_WGSL = wgslFn(
  'luma601',
  [],
  'fn luma601(c:vec3f)->f32{return dot(c,vec3f(0.299,0.587,0.114));}',
)

/** The anti-aliaser's target: its texel offset (4 bits per axis) beside its noise filtering (out of
 *  255), two 8-bit unsigned channels a texel. Its input, the LDR luma, is written by the shading
 *  rejection (`rejectionWgsl.ts`) in eight bits, filtered for the browse. */
export const ANTI_ALIASING_FORMAT: GPUTextureFormat = 'rg8uint'
export const LDR_LUMA_FORMAT: GPUTextureFormat = 'rgba8unorm'

/** The anti-aliaser's bindings. */
export const SPATIAL_AA_BINDINGS = { luma: 0, view: 1, lumaSampler: 2, rejection: 3 } as const

/**
 * The spatial anti-aliaser, per render pixel where the shading rejection asks for it (its bit in the
 * rejection's word, `ANTI_ALIAS_BIT`: aliasing visible and the history rejected or disoccluded),
 * elsewhere no offset and no noise filtering; an edge search in the manner of morphological
 * anti-aliasing (Reshetov 2009): the 3×3 LDR lumas give the direction to browse, the side the edge
 * lies on, its luma and the noise filtering; where the edge's contrast is worth it
 * (`lumaDelta > 0.05`), the edge is browsed both ways along it,
 * the level's bilinear samples (`view.quality.y`, `TaaLevelKnobs`) each half a texel toward the edge, each
 * stopping at the first that leaves the edge's mid luma band (`aaBilinear`); the two
 * lengths and how each stopped give the texel's distance to the staircase's true edge
 * (`aaDistanceToEdge`), scaled by the contrast past the threshold, encoded 4 bits an
 * axis (`aaEncode`) beside the noise filtering out of 255.
 * The history update moves its kernel centre by it (`taaResolveShader`). The targets are made at
 * the render targets' size, the image
 * drawn in their top-left `view.render.xy`: loads clamp to it, bilinear samples stop half a texel
 * inside it (`bound`), in the targets' texels. 9 loads per render pixel, and where the contrast is worth it up to twice the
 * level's bilinear samples, each side's ending at its stop.
 */
export const spatialAntiAliasingShader = () =>
  wgslProgram(
    `@group(0) @binding(${SPATIAL_AA_BINDINGS.luma}) var luma:texture_2d<f32>;
@group(0) @binding(${SPATIAL_AA_BINDINGS.view}) var<uniform> view:TaaView;
@group(0) @binding(${SPATIAL_AA_BINDINGS.lumaSampler}) var lumaSampler:sampler;
@group(0) @binding(${SPATIAL_AA_BINDINGS.rejection}) var rejection:texture_2d<f32>;
fn aaLoad(p:vec2i,offset:vec2i)->f32{return textureLoad(luma,clampTexel(p+offset),0).r;}
/** A bilinear sample at \`uv\`, held inside \`bound\`: its lowest corner on the negative side, its
 *  highest on the positive one. */
fn aaBilinear(uv:vec2f,negative:bool,bound:vec4f)->f32{
 return textureSampleLevel(luma,lumaSampler,select(min(uv,bound.zw),max(uv,bound.xy),negative),0.0).r;
}
/** How far the texel lies from the staircase's true edge, by the sides whose browse stopped past
 *  the band toward the edge's luma (\`incN\`, \`incP\`): both, half a texel; one, by its length
 *  against the whole run's; neither, none. */
fn aaDistanceToEdge(incN:bool,incP:bool,lengthN:f32,lengthP:f32)->f32{
 if(incN&&incP){return 0.5;}
 let inverse=1.0/(1.0+lengthN+lengthP);
 if(incN){return 0.5-(lengthN+0.5)*inverse;}
 if(incP){return 0.5-(lengthP+0.5)*inverse;}
 return 0.0;
}
fn aaEncode(offset:vec2f)->u32{
 let e=clamp(vec2i(round(offset*${OFFSET_SCALE.toFixed(1)}))+${OFFSET_ZERO},vec2i(1),vec2i(${OFFSET_MASK}));
 return u32(e.x)|(u32(e.y)<<4u);
}
@fragment fn spatialAntiAliasing(@builtin(position) pixel:vec4f)->@location(0) vec4u{
 let p=vec2i(pixel.xy);
 if((u32(round(textureLoad(rejection,p,0).a*255.0))&${ANTI_ALIAS_BIT}u)==0u){return vec4u(aaEncode(vec2f(0.0)),0u,0u,0u);}
 // The 3×3, each texel clamped to the rendered size (aaLoad).
 let c=aaLoad(p,vec2i(0,0));let n=aaLoad(p,vec2i(0,-1));let s=aaLoad(p,vec2i(0,1));let w=aaLoad(p,vec2i(-1,0));let e=aaLoad(p,vec2i(1,0));
 let nw=aaLoad(p,vec2i(-1,-1));let ne=aaLoad(p,vec2i(1,-1));let sw=aaLoad(p,vec2i(-1,1));let se=aaLoad(p,vec2i(1,1));
 let varHN=abs(0.5*(ne+nw)-n);let varH=abs(0.5*(e+w)-c);let varHS=abs(0.5*(se+sw)-s);
 let varVE=abs(0.5*(ne+se)-e);let varV=abs(0.5*(n+s)-c);let varVW=abs(0.5*(nw+sw)-w);
 let diffN=abs(n-c);let diffS=abs(s-c);let diffE=abs(e-c);let diffW=abs(w-c);
 let vertical=varHN+varH+varHS>varVE+varV+varVW;
 let browse=select(vec2f(1.0,0.0),vec2f(0.0,1.0),vertical);
 let noise=max(saturate(2.0*varH-max(diffE,diffW)),saturate(2.0*varV-max(diffN,diffS)));
 var side=vec2f(0.0);var edge=0.0;
 if(vertical){side.x=select(1.0,-1.0,diffW>diffE);edge=select(e,w,diffW>diffE);}
 else{side.y=select(1.0,-1.0,diffN>diffS);edge=select(s,n,diffN>diffS);}
 let lumaDelta=abs(edge-c)*0.5;
 var offset=vec2f(0.0);
 // Below the contrast worth it the edge is left: no browse.
 if(lumaDelta>${SPATIAL_ANTI_ALIASER_MIN_LUMINANCE}){
  let texel=1.0/vec2f(textureDimensions(luma));let step=browse*texel;
  let bound=vec4f(0.5*texel,(view.render.xy-0.5)*texel);
  let uv=(vec2f(p)+0.5+side*0.5)*texel;
  let merged=0.5*(edge+c);let band=0.25*abs(edge-c);let minLuma=merged-band;let maxLuma=merged+band;
  var minP=false;var maxP=false;var minN=false;var maxN=false;
  let iterations=i32(view.quality.y);
  var lengthP=f32(iterations);var lengthN=f32(iterations);
  // Each side stops at its first sample out of the band, its length the samples before it.
  for(var i=1;i<=iterations;i++){
   let at=step*f32(i);
   if(!(minP||maxP)){let lumaP=aaBilinear(uv+at,false,bound);minP=lumaP<minLuma;maxP=lumaP>maxLuma;if(minP||maxP){lengthP=f32(i-1);}}
   if(!(minN||maxN)){let lumaN=aaBilinear(uv-at,true,bound);minN=lumaN<minLuma;maxN=lumaN>maxLuma;if(minN||maxN){lengthN=f32(i-1);}}
   if((minP||maxP)&&(minN||maxN)){break;}
  }
  let brighter=edge>c;
  let incP=select(minP,maxP,brighter);let incN=select(minN,maxN,brighter);
  offset=side*saturate(lumaDelta/${SPATIAL_ANTI_ALIASER_MIN_LUMINANCE})*aaDistanceToEdge(incN,incP,lengthN,lengthP);
 }
 return vec4u(aaEncode(offset),u32(round(noise*255.0)),0u,0u);
}`,
    [TAA_VIEW_WGSL, TILE_CLAMP_WGSL, FULLSCREEN_VERTEX],
  )

/** The anti-aliaser's offset decoded from the 4-bit codes `aaEncode` wrote: `±0.5` texel an axis. */
export const ANTI_ALIAS_OFFSET_WGSL = wgslBlock(
  'ANTI_ALIAS_OFFSET_WGSL',
  [],
  `
fn decodeAntiAliasOffset(code:u32)->vec2f{
 return (vec2f(f32(code&${OFFSET_MASK}u),f32((code>>4u)&${OFFSET_MASK}u))-${OFFSET_ZERO}.0)/${OFFSET_SCALE.toFixed(1)};
}`,
)
