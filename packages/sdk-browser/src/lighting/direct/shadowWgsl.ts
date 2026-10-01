import { LIGHT_SETTINGS, MAX_SHADOW_SLICES, POINT_FACES } from '../../../../sdk-core/src/index.ts';
import {
  PAGE_INDEX_MASK,
  PAGE_RANGE_MASK,
  PAGE_RANGE_SHIFT,
  PAGE_VALID,
  SHADOW_PAGE,
  SUN_LEVELS,
  SUN_WINDOW,
} from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { pageModelWgsl } from '../../../../sdk-core/src/scene/light-shadow/pageModelWgsl.ts';
import { SHADOW_FACTOR_WGSL } from './shadowFactorWgsl.ts';
import { LAMP_SOFT_WGSL } from './lampSoftWgsl.ts';
import { shadowRequestWgsl } from './shadowRequestWgsl.ts';
import { SHADOW_SAMPLE_WGSL, SHADOW_SUBTEXELS } from './shadowSampleWgsl.ts';
import { shadowThroughWgsl } from '../../gpu/shadow/transmittance.ts';
import { SHADOW_PAGE_WORD_WGSL } from './shadowPageWgsl.ts';
import { PCF_REACH, POISSON_16, POISSON_RADIUS } from './pcfTaps.ts';

/** The PCF's taps as WGSL, in `scale`ths of a texel: a power of two, so exact. */
const poissonWgsl = (name: string, scale: number) =>
  `const ${name}:array<vec2f,${POISSON_16.length}>=array<vec2f,${POISSON_16.length}>(${POISSON_16.map(([x, y]) => `vec2f(${x * scale},${y * scale})`).join(',')});`;

/**
 * The PCF's tap count and taps, a texel apart: also the PCSS disk's (`lampSoftWgsl.ts`), whose
 * pages the per-pixel demand marks (`../../webgpu/shadow/demandWgsl.ts`). The same every image,
 * as the reference engine's filtered (PCF) virtual shadow map lookup — unlike its SMRT, whose per-frame random
 * rays TSR denoises, nothing here is left for the TAA to average; its jitter moves the receiver's
 * sample over the pixel, which the history filters.
 */
export const PCF_TAPS_WGSL = `const PCF_TAPS:u32=${LIGHT_SETTINGS.pcfTaps}u;
const POISSON_RADIUS:f32=${POISSON_RADIUS};
${poissonWgsl('POISSON', 1)}`;

/**
 * The shadow buffer as the GPU reads it: every slice's record (`SHADOW_RECORD_FLOATS`) — lamp
 * faces or sun depth ranges, the sun's frame, the window origin of each clipmap slot two by two,
 * then the header —, then the page table, one word per virtual page. One binding for both: the
 * blend stage has no storage binding to spare.
 */
export const SHADOW_DATA_WGSL = `struct ShadowRecord{faces:array<mat4x4f,${POINT_FACES}>,frame:array<vec4f,3>,origins:array<vec4i,${SUN_LEVELS / 2}>,info:vec4f,}
struct ShadowData{records:array<ShadowRecord,${MAX_SHADOW_SLICES}>,table:array<u32>,}`;

/**
 * What every reader of the page table shares — the shading and the demand pass
 * (`../../webgpu/shadow/demandWgsl.ts`) —: the table's constants, the page model, the page word
 * read, and the offset along the normal a receiver is read at.
 */
export function shadowPageReadWgsl(window = SUN_WINDOW) {
  return `
const SHADOW_NORMAL_TEXELS:f32=${LIGHT_SETTINGS.shadowNormalOffsetTexels};
const SHADOW_PCF_REACH:f32=${PCF_REACH};
const SHADOW_PAGE:f32=${SHADOW_PAGE}.0;
const PAGE_VALID:u32=${PAGE_VALID}u;
const PAGE_INDEX_MASK:u32=${PAGE_INDEX_MASK}u;
const PAGE_RANGE_SHIFT:u32=${PAGE_RANGE_SHIFT}u;
const PAGE_RANGE_MASK:u32=${PAGE_RANGE_MASK}u;
${pageModelWgsl(window)}
${SHADOW_PAGE_WORD_WGSL}
/** The point a pixel's unjittered centre holds less the one it holds (\`pixelLevel\`), which a
 *  lamp's mip is chosen at: zero in a pass that sets none. */
var<private> shadowUnjitter:vec3f=vec3f(0.0);
/** Offset along the normal, in texels of the level read, of a receiver at incidence \`cosine\`:
 *  half a texel, plus, past 45°, the part of its plane's slope the depth margin leaves. */
fn shadowNormalTexels(cosine:f32)->f32{
 return SHADOW_NORMAL_TEXELS+SHADOW_PCF_REACH*max(sqrt(1.0-cosine*cosine)-cosine,0.0);
}`;
}

/**
 * The virtual shadow read, shared by every pass that lights a surface: records and page table,
 * requests, the pool, and a PCF whose taps each find their own physical page, each read through
 * `shadowPageWord` (`shadowPageWgsl.ts`).
 *
 * A tap whose bilinear footprint lies in one page is one comparison in that page; one
 * that straddles a seam is split along it (\`shadowPcf\`): no seam, no guard band.
 *
 * The filtered result is multiplied by the transmittance layer once, at the footprint's centre
 * (\`shadowThroughLit\`, \`../../gpu/shadow/transmittance.ts\`): its two textures are bound at
 * \`transmittanceBinding\` and the number after it. A pool without that layer binds one-texel
 * stand-ins, which the PCF never reads: its result is that of before, bit for bit.
 */
export const directShadowWgsl = (
  dataBinding: number,
  requestBinding: number | null,
  transmittanceBinding: number,
  pages = SUN_WINDOW,
) => `
${SHADOW_DATA_WGSL}
@group(0) @binding(${dataBinding}) var<storage,read> shadows:ShadowData;
${shadowRequestWgsl(requestBinding, pages)}
${PCF_TAPS_WGSL}
const SHADOW_SUBTEXELS:f32=${SHADOW_SUBTEXELS}.0;
/** One step: a multiply by it is exact, where WGSL lets a division err by 2.5 ulp. */
const SHADOW_SUBTEXEL:f32=1.0/SHADOW_SUBTEXELS;
${poissonWgsl('POISSON_STEPS', SHADOW_SUBTEXELS)}
/** Pixel footprint at the lit point, in metres: set by the pass before it lights a surface. */
var<private> shadowFootprint:f32=0.0;
var<private> shadowReceiverOffset:vec3f=vec3f(0.0);
/** Depth margin, in metres toward the light, of a receiver whose depth changes by \`slope\` per
 *  unit across the map: its plane over the PCF's reach, up to \`cap\`, a slope of 1 in the
 *  caller's units. ADDED to the reference: shadow depth is reversed. */
fn shadowDepthMargin(texel:f32,slope:f32,cap:f32)->f32{return texel*SHADOW_PCF_REACH*min(slope,cap);}
${shadowPageReadWgsl(pages)}
${SHADOW_SAMPLE_WGSL}
${shadowThroughWgsl(transmittanceBinding)}
/**
 * Sixteen taps a texel apart around \`t\`; a lamp face clamps them at its edge (\`side\` > 0).
 * Every tap's bilinear footprint lies within \`PCF_EDGE_TEXELS\` of \`t\` (\`pageModel.ts\`), so the
 * filter reaches at most the home page's neighbours across the one or two edges that close
 * (\`shadowPcfEdge\`, \`shadowPcfStep\`): their words are read, and
 * asked for, once per pixel, before the taps. Away from any edge — all but the pixels within two
 * texels of one — each tap is one comparison in the home page.
 *
 * Near an edge a tap is split along the seam, never texel by texel: each page's share of the
 * bilinear weight across the seam, \`saturate(0.5 + distance to the seam)\`, multiplies one
 * comparison in that page, clamped to its last texel centre on that axis, the other axis
 * still filtered bilinearly. A tap is thus two comparisons beside one edge, four at a corner,
 * which the pixel decides once for all its taps. A neighbour not readable is read at the home page's nearest texel.
 * Without \`taps\` (\`declaredLight\`: no light reaches the point) it is zero, its pages still asked for.
 */
fn shadowPcf(m:ShadowMap,t:vec2f,reference:f32,home:vec2i,homeWord:u32,side:f32,taps:bool)->f32{
 let first=vec2f(home)*SHADOW_PAGE;
 let edge=vec2i(shadowPcfEdge(t.x,first.x),shadowPcfEdge(t.y,first.y))>vec2i(0);
 let offset=shadowOffset(homeWord,home);
 let step=vec2i(shadowPcfStep(t.x,first.x),shadowPcfStep(t.y,first.y));
 let up=step>vec2i(0);
 let n=shadowNeighbours(m,home,step,edge,offset,homeWord);
 if(!taps){return 0.0;}
 var lit=0.0;
 if(!any(edge)){
  // \`shadowCompare\` per tap, in steps: \`(t + tap)·256\` is \`t·256 + tap·256\` to the bit.
  let texels=shadowAtlasTexels();let layer=i32(offset.z);let steps=t*SHADOW_SUBTEXELS;
  for(var tap=0u;tap<PCF_TAPS;tap++){
   lit+=shadowSample(offset.xy+floor(steps+POISSON_STEPS[tap]+0.5)*SHADOW_SUBTEXEL,layer,texels,reference);
  }
  return shadowThroughLit(offset,first,t,reference,lit/f32(PCF_TAPS));
 }
 for(var tap=0u;tap<PCF_TAPS;tap++){
  var at=t+POISSON[tap];
  if(side>0.0){at=clamp(at,vec2f(0.5),vec2f(side-0.5));}
  lit+=shadowSplitTap(offset,n,edge,up,first,at,reference);
 }
 return shadowThroughLit(offset,first,t,reference,lit/f32(PCF_TAPS));
}
/** \`shadowCompare\` at \`at\` split along the home page's seams (\`up\`): each page's share of the
 *  footprint, \`saturate(0.5 + distance to the seam)\`, read in that page, the neighbours \`n\` on
 *  the \`edge\` axes. Shared by \`shadowPcf\` and the PCSS filter (\`lampSoftCompare\`). */
fn shadowSplitTap(offset:vec3f,n:ShadowNeighbours,edge:vec2<bool>,up:vec2<bool>,first:vec2f,at:vec2f,reference:f32)->f32{
 let toward=select(vec2f(-1.0),vec2f(1.0),up);
 let seam=first+select(vec2f(0.0),vec2f(SHADOW_PAGE),up);
 let h=clamp(at,first+0.5,first+SHADOW_PAGE-0.5);
 let beyond=select(min(at,seam-0.5),max(at,seam+0.5),up);
 let w=saturate(0.5+(seam-at)*toward);
 var sum=w.x*w.y*shadowCompare(offset,h,reference);
 if(edge.x){sum+=(1.0-w.x)*w.y*shadowCompare(n.x.xyz,vec2f(select(h.x,beyond.x,n.x.w>0.0),h.y),reference);}
 if(edge.y){sum+=w.x*(1.0-w.y)*shadowCompare(n.y.xyz,vec2f(h.x,select(h.y,beyond.y,n.y.w>0.0)),reference);}
 if(all(edge)){sum+=(1.0-w.x)*(1.0-w.y)*shadowCompare(n.d.xyz,select(h,beyond,n.d.w>0.0),reference);}
 return sum;
}
${SHADOW_FACTOR_WGSL}
${LAMP_SOFT_WGSL}`;
